import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentRejectionStatus, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import { whatsAppIds } from '../common/phone-match'
import { BotNotifierService } from '../inbox/bot-notifier.service'
import { CreatePaymentRejectionImportDto, PaymentRejectionRowDto } from './dto/payment-rejection.dto'
import { channelOf, noticeParams, renderNotice } from './rejection-notice'

const { READY, SKIPPED, SENDING, SENT, FAILED, MARKED } = PaymentRejectionStatus

/** Why a row is left out of the send by default. */
const SKIP_REASON = {
  NO_PHONE: 'NO_PHONE',
  ALREADY_PAID: 'ALREADY_PAID',
  ALREADY_NOTIFIED: 'ALREADY_NOTIFIED',
} as const

/** Rows the office can still send or mark: never sent, left out, or failed. */
const OPEN_STATUSES: PaymentRejectionStatus[] = [READY, SKIPPED, FAILED]

/**
 * Pause between notices. Meta caps throughput per number, and a burst of the
 * same template to dozens of people is what its quality checks flag as spam.
 */
const SEND_GAP_MS = 1500

const REJECTION_SELECT = {
  id: true,
  rowNumber: true,
  holderName: true,
  branch: true,
  certificateNumber: true,
  endorsementNumber: true,
  installmentNumber: true,
  dueDate: true,
  amount: true,
  entity: true,
  channel: true,
  accountLast4: true,
  reason: true,
  stillPending: true,
  phone: true,
  waId: true,
  status: true,
  skipReason: true,
  error: true,
  sentAt: true,
  conversationId: true,
  client: { select: { id: true, firstName: true, lastName: true } },
  sentBy: { select: { name: true, email: true } },
} satisfies Prisma.PaymentRejectionSelect

type RejectionRow = Prisma.PaymentRejectionGetPayload<{ select: typeof REJECTION_SELECT }>

/** A WhatsApp number that can send, with the codes it serves. */
interface Sender {
  phoneNumberId: string
  codeIds: number[]
}

/**
 * "Rechazos": the office loads Triunfo's Excel of rejected automatic debits and
 * the bot tells each client on WhatsApp, with the approved template
 * PAYMENT_REJECTION_TEMPLATE. Each notice lands in the client's chat as a
 * message from the office, so the panel shows it and the bot reads the client's
 * answer as a reply to it.
 */
@Injectable()
export class RejectionsService implements OnModuleInit {
  private readonly logger = new Logger(RejectionsService.name)
  private readonly template: string | undefined
  private readonly templateLang: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly botNotifier: BotNotifierService,
    config: ConfigService,
  ) {
    this.template = config.get<string>('PAYMENT_REJECTION_TEMPLATE') || undefined
    this.templateLang = config.get<string>('PAYMENT_REJECTION_TEMPLATE_LANG') || 'es_AR'
  }

  /**
   * A restart in the middle of a send leaves rows in SENDING forever. The one
   * in flight may have reached the client, so the office checks before retrying.
   */
  async onModuleInit() {
    const { count } = await this.prisma.paymentRejection.updateMany({
      where: { status: SENDING },
      data: {
        status: FAILED,
        error: 'El envío se cortó por un reinicio del sistema: revisá el chat antes de reintentar.',
      },
    })
    if (count) this.logger.warn(`${count} avisos de rechazo quedaron a medio enviar tras un reinicio`)
  }

  async list(user: ScopeUser) {
    const imports = await this.prisma.paymentRejectionImport.findMany({
      where: { producerId: user.producerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        periodLabel: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    })
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    const counts = imports.length
      ? await this.prisma.paymentRejection.groupBy({
          by: ['importId', 'status'],
          where: { importId: { in: imports.map(i => i.id) }, deletedAt: null, ...rowScope(codeIds) },
          _count: { _all: true },
        })
      : []
    return {
      templateReady: !!this.template,
      imports: imports.map(i => ({
        ...i,
        counts: Object.fromEntries(
          counts.filter(c => c.importId === i.id).map(c => [c.status, c._count._all]),
        ) as Partial<Record<PaymentRejectionStatus, number>>,
      })),
    }
  }

  /**
   * Stores the rows of an Excel, each matched to its policy and client, with
   * the WhatsApp number to write to and whether it should go out by default.
   */
  async create(user: ScopeUser, dto: CreatePaymentRejectionImportDto) {
    const { producerId } = user
    const headerCodeId = await this.headerCode(user, dto.producerCode)

    const certificates = [...new Set(dto.rows.map(r => r.certificateNumber))]
    const policies = await this.prisma.policy.findMany({
      where: { producerId, certificateNumber: { in: certificates }, deletedAt: null },
      select: {
        id: true,
        certificateNumber: true,
        producerCodeId: true,
        client: { select: { id: true, phone: true, deletedAt: true } },
      },
    })
    const policyByCertificate = new Map(policies.map(p => [p.certificateNumber, p]))
    const notified = await this.alreadyNotified(producerId, certificates)

    const phoneSources = (row: PaymentRejectionRowDto) => {
      const client = policyByCertificate.get(row.certificateNumber)?.client
      return [row.mobilePhone, row.homePhone, client?.deletedAt ? null : client?.phone]
    }
    const knownWaIds = await this.knownWaIds(
      producerId,
      dto.rows.flatMap(row => phoneSources(row).flatMap(whatsAppIds)),
    )

    const data = dto.rows.map(row => {
      const policy = policyByCertificate.get(row.certificateNumber)
      const client = policy?.client && !policy.client.deletedAt ? policy.client : null
      const target = pickWhatsApp(phoneSources(row), knownWaIds)
      const dueDate = new Date(`${row.dueDate}T00:00:00.000Z`)
      const skipReason = !target
        ? SKIP_REASON.NO_PHONE
        : !row.stillPending
          ? SKIP_REASON.ALREADY_PAID
          : notified.has(installmentKey(row.certificateNumber, row.installmentNumber, dueDate))
            ? SKIP_REASON.ALREADY_NOTIFIED
            : null
      return {
        rowNumber: row.rowNumber,
        holderName: row.holderName.trim(),
        branch: row.branch ?? null,
        certificateNumber: row.certificateNumber,
        endorsementNumber: row.endorsementNumber ?? null,
        installmentNumber: row.installmentNumber,
        dueDate,
        amount: new Prisma.Decimal(row.amount),
        entity: row.entity.trim(),
        channel: channelOf(row.entity),
        accountLast4: row.accountLast4 ?? null,
        reason: row.reason.trim(),
        stillPending: row.stillPending,
        phone: target?.phone ?? row.mobilePhone ?? row.homePhone ?? null,
        waId: target?.waId ?? null,
        status: skipReason ? SKIPPED : READY,
        skipReason,
        producerId,
        producerCodeId: policy?.producerCodeId ?? headerCodeId,
        policyId: policy?.id ?? null,
        clientId: client?.id ?? null,
      }
    })

    const created = await this.prisma.paymentRejectionImport.create({
      data: {
        fileName: dto.fileName.trim(),
        periodLabel: dto.periodLabel?.trim() || null,
        producerId,
        createdById: user.id,
        rejections: { createMany: { data } },
      },
      select: { id: true },
    })
    return this.detail(user, created.id)
  }

  async detail(user: ScopeUser, importId: number) {
    const found = await this.prisma.paymentRejectionImport.findFirst({
      where: { id: importId, producerId: user.producerId, deletedAt: null },
      select: {
        id: true,
        fileName: true,
        periodLabel: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    })
    if (!found) throw new NotFoundException(`Rejection import ${importId} not found`)

    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    const rows = await this.prisma.paymentRejection.findMany({
      where: { importId, deletedAt: null, ...rowScope(codeIds) },
      orderBy: { rowNumber: 'asc' },
      select: REJECTION_SELECT,
    })
    return { ...found, templateReady: !!this.template, rows: rows.map(toResponse) }
  }

  /**
   * Hands the chosen rows to the bot one by one, in the background: the panel
   * polls the import while any row is SENDING.
   */
  async send(user: ScopeUser, importId: number, ids: number[]) {
    const template = this.template
    if (!template) {
      throw new ConflictException(
        'La plantilla de WhatsApp para avisar rechazos todavía no está habilitada. No se envió ningún aviso.',
      )
    }
    await this.assertImport(user, importId)

    const senders = await this.senders(user.producerId)
    if (!senders.length) {
      throw new ConflictException('No hay un número de WhatsApp conectado para enviar los avisos. Revisalo en Números.')
    }

    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    const candidates = await this.prisma.paymentRejection.findMany({
      where: {
        id: { in: ids },
        importId,
        deletedAt: null,
        status: { in: OPEN_STATUSES },
        waId: { not: null },
        ...rowScope(codeIds),
      },
      orderBy: { rowNumber: 'asc' },
      select: { id: true },
    })

    // Claimed one by one so a double click never sends the same notice twice.
    const claimed: number[] = []
    for (const { id } of candidates) {
      const { count } = await this.prisma.paymentRejection.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: { status: SENDING, error: null, sentById: user.id },
      })
      if (count) claimed.push(id)
    }
    if (!claimed.length) throw new BadRequestException('Ninguno de los avisos elegidos se puede enviar.')

    void this.deliverAll(claimed, { template, senders }).catch(error =>
      this.logger.error(`Se cortó el envío de avisos de rechazo: ${(error as Error).message}`),
    )
    return this.detail(user, importId)
  }

  /** The office told these clients by other means: they will not be sent again. */
  async mark(user: ScopeUser, importId: number, ids: number[]) {
    await this.assertImport(user, importId)
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    await this.prisma.paymentRejection.updateMany({
      where: { id: { in: ids }, importId, deletedAt: null, status: { in: OPEN_STATUSES }, ...rowScope(codeIds) },
      data: { status: MARKED, sentAt: new Date(), sentById: user.id, error: null },
    })
    return this.detail(user, importId)
  }

  async remove(user: ScopeUser, importId: number) {
    await this.assertImport(user, importId)
    const sending = await this.prisma.paymentRejection.count({ where: { importId, status: SENDING } })
    if (sending) throw new ConflictException('Esperá a que terminen de enviarse los avisos antes de borrar la carga.')

    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.paymentRejection.updateMany({ where: { importId, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.paymentRejectionImport.update({ where: { id: importId }, data: { deletedAt: now } }),
    ])
    return { ok: true }
  }

  // ─── Sending ───────────────────────────────────────────

  private async deliverAll(ids: number[], ctx: { template: string; senders: Sender[] }) {
    for (const [index, id] of ids.entries()) {
      if (index > 0) await sleep(SEND_GAP_MS)
      try {
        await this.deliverOne(id, ctx)
      } catch (error) {
        this.logger.error(`Aviso de rechazo ${id}: ${(error as Error).message}`)
        await this.prisma.paymentRejection.updateMany({
          where: { id, status: SENDING },
          data: { status: FAILED, error: 'No se pudo enviar el aviso. Probá de nuevo en unos minutos.' },
        })
      }
    }
  }

  private async deliverOne(id: number, ctx: { template: string; senders: Sender[] }) {
    const row = await this.prisma.paymentRejection.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        holderName: true,
        certificateNumber: true,
        installmentNumber: true,
        dueDate: true,
        amount: true,
        reason: true,
        waId: true,
        producerId: true,
        producerCodeId: true,
        clientId: true,
        client: { select: { firstName: true } },
      },
    })
    const waId = row.waId
    if (!waId) throw new InternalServerErrorException('Row has no WhatsApp id')

    const params = noticeParams({
      holderName: row.holderName,
      clientFirstName: row.client?.firstName,
      certificateNumber: row.certificateNumber,
      installmentNumber: row.installmentNumber,
      dueDate: row.dueDate,
      amount: row.amount.toNumber(),
      reason: row.reason,
    })
    const existing = await this.prisma.conversation.findUnique({
      where: { waId_producerId: { waId, producerId: row.producerId } },
      select: { id: true, clientId: true, phoneNumberId: true },
    })
    const phoneNumberId = pickSender(ctx.senders, existing?.phoneNumberId, row.producerCodeId)

    try {
      await this.botNotifier.sendTemplate({
        to: waId,
        phoneNumberId,
        template: ctx.template,
        lang: this.templateLang,
        params,
      })
    } catch (error) {
      await this.prisma.paymentRejection.update({
        where: { id },
        data: { status: FAILED, error: describeFailure(error) },
      })
      return
    }

    try {
      const conversationId = await this.recordInChat(row, existing, phoneNumberId, renderNotice(params))
      await this.prisma.paymentRejection.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: null, conversationId },
      })
    } catch (error) {
      // WhatsApp already took it: it must not look unsent and go out twice.
      this.logger.error(`Aviso de rechazo ${id} enviado pero no guardado en el chat: ${(error as Error).message}`)
      await this.prisma.paymentRejection.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: 'Se envió, pero no quedó registrado en el chat del panel.' },
      })
    }
  }

  /**
   * The notice as the office's message in the client's chat (created when they
   * never wrote): the inbox shows it, and for the next days the bot reads what
   * the client writes as an answer to it instead of greeting them from scratch.
   */
  private recordInChat(
    row: {
      id: number
      waId: string | null
      producerId: number
      producerCodeId: number | null
      clientId: number | null
    },
    existing: { id: number; clientId: number | null } | null,
    phoneNumberId: string,
    content: string,
  ): Promise<number> {
    return this.prisma.$transaction(async tx => {
      const now = new Date()
      let conversationId: number
      if (existing) {
        conversationId = existing.id
        if (!existing.clientId && row.clientId) {
          await tx.conversation.update({
            where: { id: existing.id },
            data: { clientId: row.clientId, clientLinkedAt: now },
          })
        }
      } else {
        const created = await tx.conversation.create({
          data: {
            waId: row.waId as string,
            producerId: row.producerId,
            phoneNumberId,
            producerCodeId: row.producerCodeId,
            clientId: row.clientId,
            clientLinkedAt: row.clientId ? now : null,
            sessionStartedAt: now,
          },
          select: { id: true },
        })
        conversationId = created.id
      }
      const message = await tx.message.create({
        data: { conversationId, role: 'agent', content, rawData: { paymentRejectionId: row.id } },
        select: { createdAt: true },
      })
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } })
      return conversationId
    })
  }

  /** Active numbers that can send, the ones on a connected WABA first. */
  private async senders(producerId: number): Promise<Sender[]> {
    const phones = await this.prisma.phoneNumber.findMany({
      where: {
        producerId,
        isActive: true,
        deletedAt: null,
        OR: [{ wabaAccountId: null }, { wabaAccount: { disconnectedAt: null } }],
      },
      orderBy: { id: 'asc' },
      select: {
        phoneNumberId: true,
        wabaAccountId: true,
        responsibleProducerCodeId: true,
        servedCodes: { select: { producerCodeId: true } },
      },
    })
    return phones
      .sort((a, b) => Number(b.wabaAccountId != null) - Number(a.wabaAccountId != null))
      .map(p => ({
        phoneNumberId: p.phoneNumberId,
        codeIds: [
          ...(p.responsibleProducerCodeId != null ? [p.responsibleProducerCodeId] : []),
          ...p.servedCodes.map(s => s.producerCodeId),
        ],
      }))
  }

  // ─── Helpers ───────────────────────────────────────────

  private async assertImport(user: ScopeUser, importId: number) {
    const found = await this.prisma.paymentRejectionImport.findFirst({
      where: { id: importId, producerId: user.producerId, deletedAt: null },
      select: { id: true },
    })
    if (!found) throw new NotFoundException(`Rejection import ${importId} not found`)
  }

  /** The code in the Excel's header, when it is one of the organization's and the user may see it. */
  private async headerCode(user: ScopeUser, code: string | undefined): Promise<number | null> {
    if (!code) return null
    const found = await this.prisma.producerCode.findFirst({
      where: { producerId: user.producerId, code, deletedAt: null },
      select: { id: true },
    })
    if (!found) return null
    if (!(await this.scope.canAccessCode(user, found.id))) {
      throw new ForbiddenException(`No tenés acceso al código ${code} de este Excel.`)
    }
    return found.id
  }

  /** Installments already told about in an earlier Excel (Triunfo's files overlap in time). */
  private async alreadyNotified(producerId: number, certificates: string[]): Promise<Set<string>> {
    const previous = await this.prisma.paymentRejection.findMany({
      where: {
        producerId,
        certificateNumber: { in: certificates },
        status: { in: [SENT, MARKED] },
        deletedAt: null,
      },
      select: { certificateNumber: true, installmentNumber: true, dueDate: true },
    })
    return new Set(previous.map(p => installmentKey(p.certificateNumber, p.installmentNumber, p.dueDate)))
  }

  /** WhatsApp ids among `candidates` that already have a chat: they surely use WhatsApp. */
  private async knownWaIds(producerId: number, candidates: string[]): Promise<Set<string>> {
    if (!candidates.length) return new Set()
    const chats = await this.prisma.conversation.findMany({
      where: { producerId, waId: { in: [...new Set(candidates)] } },
      select: { waId: true },
    })
    return new Set(chats.map(c => c.waId))
  }
}

/** Rows of the codes the user may see, plus rows not tied to any code. */
function rowScope(codeIds: number[]): Prisma.PaymentRejectionWhereInput {
  return { OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }] }
}

function installmentKey(certificate: string, installment: number, dueDate: Date): string {
  return `${certificate}:${installment}:${dueDate.toISOString().slice(0, 10)}`
}

/**
 * The first phone, in order of preference, that reads as one WhatsApp id. A
 * mobile whose `15` split is ambiguous counts only if one reading already
 * wrote to us.
 */
export function pickWhatsApp(
  phones: Array<string | null | undefined>,
  known: Set<string>,
): { phone: string; waId: string } | null {
  for (const phone of phones) {
    if (!phone) continue
    const ids = whatsAppIds(phone)
    const waId = ids.length === 1 ? ids[0] : ids.find(id => known.has(id))
    if (waId) return { phone, waId }
  }
  return null
}

/** The number the client already talks to, else one serving the policy's code, else the first. */
export function pickSender(senders: Sender[], current: string | null | undefined, codeId: number | null): string {
  if (current && senders.some(s => s.phoneNumberId === current)) return current
  const forCode = codeId != null ? senders.find(s => s.codeIds.includes(codeId)) : undefined
  return (forCode ?? senders[0]).phoneNumberId
}

function toResponse(row: RejectionRow) {
  const params = noticeParams({
    holderName: row.holderName,
    clientFirstName: row.client?.firstName,
    certificateNumber: row.certificateNumber,
    installmentNumber: row.installmentNumber,
    dueDate: row.dueDate,
    amount: row.amount.toNumber(),
    reason: row.reason,
  })
  return {
    ...row,
    dueDate: row.dueDate.toISOString().slice(0, 10),
    amount: row.amount.toNumber(),
    message: renderNotice(params),
  }
}

/** Why WhatsApp did not take the notice, for the office. */
function describeFailure(error: unknown): string {
  if (error instanceof HttpException && error.getStatus() === 502) return error.message.slice(0, 500)
  return 'No se pudo enviar: el bot no respondió. Probá de nuevo en unos minutos.'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
