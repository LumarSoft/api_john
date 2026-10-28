import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { describeFailure, pickSender, pickWhatsApp, SEND_GAP_MS, Sender, sleep } from '../notices/notice-delivery'
import { NoticeDeliveryService } from '../notices/notice-delivery.service'
import { CreatePaymentRejectionImportDto, PaymentRejectionRowDto } from './dto/payment-rejection.dto'
import { channelOf, noticeParams, renderNotice } from './rejection-notice'

export { pickSender, pickWhatsApp } from '../notices/notice-delivery'

const { READY, SKIPPED, SENDING, SENT, FAILED, MARKED } = PaymentRejectionStatus

/** Why a row is left out of the send by default. */
const SKIP_REASON = {
  NO_PHONE: 'NO_PHONE',
  ALREADY_PAID: 'ALREADY_PAID',
  ALREADY_NOTIFIED: 'ALREADY_NOTIFIED',
} as const

/** Rows the office can still send or mark: never sent, left out, or failed. */
const OPEN_STATUSES: PaymentRejectionStatus[] = [READY, SKIPPED, FAILED]

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
    private readonly delivery: NoticeDeliveryService,
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
    const knownWaIds = await this.delivery.knownWaIds(
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

    const senders = await this.delivery.senders(user.producerId)
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
    const existing = await this.delivery.findConversation(waId, row.producerId)
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
      const conversationId = await this.delivery.recordInChat(
        { ...row, waId },
        existing,
        phoneNumberId,
        renderNotice(params),
        { paymentRejectionId: row.id, notice: 'payment_rejection' },
      )
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
}

/** Rows of the codes the user may see, plus rows not tied to any code. */
function rowScope(codeIds: number[]): Prisma.PaymentRejectionWhereInput {
  return { OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }] }
}

function installmentKey(certificate: string, installment: number, dueDate: Date): string {
  return `${certificate}:${installment}:${dueDate.toISOString().slice(0, 10)}`
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
