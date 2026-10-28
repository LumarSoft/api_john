import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PolicyExpiryNoticeStatus, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { parseBotProfile } from '../common/bot-profile'
import { notCancelledPolizaWhere } from '../common/poliza-vigencia'
import { productNameOf } from '../common/poliza-detail'
import { BotNotifierService } from '../inbox/bot-notifier.service'
import { describeFailure, pickSender, pickWhatsApp, SEND_GAP_MS, Sender, sleep } from '../notices/notice-delivery'
import { NoticeDeliveryService } from '../notices/notice-delivery.service'
import { ExpiredPolicySort, ListExpiredPoliciesDto } from './dto/list-expired-policies.dto'
import { expiryNoticeParams, renderExpiryNotice } from './expiry-notice'

const { SENDING, SENT, FAILED, MARKED } = PolicyExpiryNoticeStatus

/**
 * Older than this and nobody is going to renew: in production every expired
 * policy still worth a call was within the year, and the rest was noise.
 */
const MAX_DAYS_EXPIRED = 365

/** A client told about a policy this recently is not told again, whatever the office ticks. */
const RENOTIFY_AFTER_DAYS = 30

const DAY_MS = 86_400_000

/** Why a ticked policy was left out of a send. */
export const SKIP_REASON = {
  NO_PHONE: 'NO_PHONE',
  ALREADY_NOTIFIED: 'ALREADY_NOTIFIED',
  SENDING: 'SENDING',
} as const
type SkipReason = (typeof SKIP_REASON)[keyof typeof SKIP_REASON]

/** What a policy covered, as the client knows it, when there is no plate or product. */
const RISK_LABELS: Record<string, string> = {
  auto: 'auto',
  moto: 'moto',
  life: 'vida',
  home: 'hogar',
  commercial: 'comercio',
  other: 'otros riesgos',
}

const ROW_SELECT = {
  id: true,
  certificateNumber: true,
  riskType: true,
  validTo: true,
  paymentMethod: true,
  rawData: true,
  hiddenAt: true,
  hiddenReason: true,
  clientId: true,
  producerCode: { select: { id: true, code: true } },
  client: { select: { id: true, firstName: true, lastName: true, dni: true, phone: true, email: true } },
  vehicle: { select: { licensePlate: true, brand: true, model: true, year: true } },
  installments: {
    where: { deletedAt: null, status: { in: ['pending', 'overdue', 'rejected'] } },
    select: { id: true },
  },
  // The last notice, whatever became of it: the office sees it was tried.
  expiryNotices: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, sentAt: true, createdAt: true, error: true },
  },
} satisfies Prisma.PolicySelect

type PolicyRow = Prisma.PolicyGetPayload<{ select: typeof ROW_SELECT }>

/**
 * The "pólizas vencidas" worklist of the cobranzas screen: policies that ran
 * out and were not renewed, so the office can call and offer a renewal, tell
 * the client on WhatsApp with the template POLICY_EXPIRY_TEMPLATE, or hide
 * the ones it knows are gone for good.
 *
 * In production 3,249 policies had an end date in the past, but 1,062 were
 * cancelled by Triunfo and 2,191 had the same plate on a policy in force for
 * the same client — renewals, which get a new certificate and leave the old
 * row behind. What was left: 195 policies of 180 clients, all within the year.
 */
@Injectable()
export class ExpiredPoliciesService implements OnModuleInit {
  private readonly logger = new Logger(ExpiredPoliciesService.name)
  private readonly template: string | undefined
  private readonly templateLang: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifier: BotNotifierService,
    private readonly delivery: NoticeDeliveryService,
    config: ConfigService,
  ) {
    this.template = config.get<string>('POLICY_EXPIRY_TEMPLATE') || undefined
    this.templateLang = config.get<string>('POLICY_EXPIRY_TEMPLATE_LANG') || 'es_AR'
  }

  /** A restart in the middle of a send leaves notices in SENDING forever. */
  async onModuleInit() {
    const { count } = await this.prisma.policyExpiryNotice.updateMany({
      where: { status: SENDING },
      data: {
        status: FAILED,
        error: 'El envío se cortó por un reinicio del sistema: revisá el chat antes de reintentar.',
      },
    })
    if (count) this.logger.warn(`${count} avisos de póliza vencida quedaron a medio enviar tras un reinicio`)
  }

  async list(producerId: number, codeIds: number[], query: ListExpiredPoliciesDto, now = new Date()) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const scope = this.scopeWhere(producerId, codeIds, query, now)

    const [candidates, hiddenCount] = await Promise.all([
      this.prisma.policy.findMany({
        where: { ...scope, hiddenAt: query.hidden ? { not: null } : null },
        select: ROW_SELECT,
      }),
      this.prisma.policy.count({ where: { ...scope, hiddenAt: { not: null } } }),
    ])

    const renewed = await this.renewedKeys(
      producerId,
      candidates.map(p => p.clientId),
      now,
    )
    const rows = candidates
      .filter(p => !renewed.has(renewalKey(p.clientId, p.vehicle?.licensePlate, p.riskType)))
      .map(p => this.toRow(p, now))

    const direction = query.sort === ExpiredPolicySort.RECENT ? -1 : 1
    rows.sort(
      (a, b) => direction * (b.daysExpired - a.daysExpired) || a.client.lastName.localeCompare(b.client.lastName),
    )

    const total = rows.length
    const data = rows.slice((page - 1) * pageSize, page * pageSize)
    return {
      data,
      total,
      hiddenCount,
      templateReady: !!this.template,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async hide(id: number, producerId: number, codeIds: number[], userId: number, reason?: string) {
    await this.findInScope(id, producerId, codeIds)
    const reasonText = reason?.trim() || null
    return this.prisma.policy.update({
      where: { id },
      data: { hiddenAt: new Date(), hiddenReason: reasonText, hiddenById: userId },
      select: { id: true, hiddenAt: true, hiddenReason: true },
    })
  }

  async unhide(id: number, producerId: number, codeIds: number[]) {
    await this.findInScope(id, producerId, codeIds)
    return this.prisma.policy.update({
      where: { id },
      data: { hiddenAt: null, hiddenReason: null, hiddenById: null },
      select: { id: true, hiddenAt: true, hiddenReason: true },
    })
  }

  // ─── Notices ───────────────────────────────────────────

  /**
   * Tells the clients of the ticked policies on WhatsApp, one by one in the
   * background: the panel polls the list while any notice is SENDING. A
   * policy without a usable phone, one told in the last month or one still
   * going out is left out and reported as such.
   */
  async send(user: { id: number; producerId: number }, codeIds: number[], ids: number[], now = new Date()) {
    const template = this.template
    if (!template) {
      throw new ConflictException(
        'La plantilla de WhatsApp para avisar pólizas vencidas todavía no está habilitada. No se envió ningún aviso.',
      )
    }
    const senders = await this.delivery.senders(user.producerId)
    if (!senders.length) {
      throw new ConflictException('No hay un número de WhatsApp conectado para enviar los avisos. Revisalo en Números.')
    }

    const policies = await this.sendablePolicies(user.producerId, codeIds, ids, now)
    const known = await this.delivery.knownWaIds(
      user.producerId,
      policies.flatMap(p => (p.client.phone ? [p.client.phone] : [])),
    )

    const claimed: number[] = []
    const skipped: Array<{ policyId: number; reason: SkipReason }> = []
    for (const policy of policies) {
      const reason = this.skipReason(policy)
      if (reason) {
        skipped.push({ policyId: policy.id, reason })
        continue
      }
      const target = pickWhatsApp([policy.client.phone], known)
      if (!target) {
        skipped.push({ policyId: policy.id, reason: SKIP_REASON.NO_PHONE })
        continue
      }
      const notice = await this.prisma.policyExpiryNotice.create({
        data: {
          status: SENDING,
          phone: target.phone,
          waId: target.waId,
          producerId: user.producerId,
          producerCodeId: policy.producerCodeId,
          policyId: policy.id,
          clientId: policy.clientId,
          sentById: user.id,
        },
        select: { id: true },
      })
      claimed.push(notice.id)
    }
    if (!claimed.length) throw new BadRequestException('Ninguno de los avisos elegidos se puede enviar.')

    void this.deliverAll(claimed, { template, senders }).catch(error =>
      this.logger.error(`Se cortó el envío de avisos de póliza vencida: ${(error as Error).message}`),
    )
    return { sent: claimed.length, skipped }
  }

  /** The office told these clients by other means: the list shows it, and they are not sent again for a month. */
  async mark(user: { id: number; producerId: number }, codeIds: number[], ids: number[], now = new Date()) {
    const policies = await this.sendablePolicies(user.producerId, codeIds, ids, now)
    const marked = policies.filter(p => this.skipReason(p) !== SKIP_REASON.SENDING)
    if (marked.length) {
      await this.prisma.policyExpiryNotice.createMany({
        data: marked.map(p => ({
          status: MARKED,
          sentAt: now,
          phone: p.client.phone,
          producerId: user.producerId,
          producerCodeId: p.producerCodeId,
          policyId: p.id,
          clientId: p.clientId,
          sentById: user.id,
        })),
      })
    }
    return { marked: marked.length }
  }

  /** Visible expired policies of the codes in scope among `ids`, with what a send needs to know. */
  private sendablePolicies(producerId: number, codeIds: number[], ids: number[], now: Date) {
    const since = new Date(now.getTime() - RENOTIFY_AFTER_DAYS * DAY_MS)
    return this.prisma.policy.findMany({
      where: { id: { in: ids }, ...this.scopeWhere(producerId, codeIds, {}, now), hiddenAt: null },
      select: {
        id: true,
        producerCodeId: true,
        clientId: true,
        client: { select: { phone: true, deletedAt: true } },
        expiryNotices: {
          where: {
            deletedAt: null,
            OR: [{ status: SENDING }, { status: { in: [SENT, MARKED] }, createdAt: { gte: since } }],
          },
          select: { status: true },
        },
      },
    })
  }

  private skipReason(policy: {
    client: { phone: string | null; deletedAt: Date | null }
    expiryNotices: Array<{ status: PolicyExpiryNoticeStatus }>
  }): SkipReason | null {
    if (policy.expiryNotices.some(n => n.status === SENDING)) return SKIP_REASON.SENDING
    if (policy.expiryNotices.length) return SKIP_REASON.ALREADY_NOTIFIED
    if (!policy.client.phone || policy.client.deletedAt) return SKIP_REASON.NO_PHONE
    return null
  }

  private async deliverAll(ids: number[], ctx: { template: string; senders: Sender[] }) {
    for (const [index, id] of ids.entries()) {
      if (index > 0) await sleep(SEND_GAP_MS)
      try {
        await this.deliverOne(id, ctx)
      } catch (error) {
        this.logger.error(`Aviso de póliza vencida ${id}: ${(error as Error).message}`)
        await this.prisma.policyExpiryNotice.updateMany({
          where: { id, status: SENDING },
          data: { status: FAILED, error: 'No se pudo enviar el aviso. Probá de nuevo en unos minutos.' },
        })
      }
    }
  }

  private async deliverOne(id: number, ctx: { template: string; senders: Sender[] }) {
    const notice = await this.prisma.policyExpiryNotice.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        waId: true,
        producerId: true,
        producerCodeId: true,
        clientId: true,
        client: { select: { firstName: true } },
        policy: {
          select: {
            certificateNumber: true,
            riskType: true,
            validTo: true,
            rawData: true,
            vehicle: { select: { licensePlate: true } },
          },
        },
        producer: { select: { name: true, botProfile: true } },
      },
    })
    const waId = notice.waId
    if (!waId) throw new InternalServerErrorException('Notice has no WhatsApp id')

    const { policy, producer } = notice
    const params = expiryNoticeParams({
      clientFirstName: notice.client.firstName,
      organizationName: parseBotProfile(producer.botProfile).orgName || producer.name,
      certificateNumber: policy.certificateNumber,
      item:
        policy.vehicle?.licensePlate ||
        productNameOf(policy.riskType, policy.rawData) ||
        RISK_LABELS[policy.riskType] ||
        policy.riskType,
      validTo: policy.validTo ?? new Date(),
    })
    const existing = await this.delivery.findConversation(waId, notice.producerId)
    const phoneNumberId = pickSender(ctx.senders, existing?.phoneNumberId, notice.producerCodeId)

    try {
      await this.botNotifier.sendTemplate({
        to: waId,
        phoneNumberId,
        template: ctx.template,
        lang: this.templateLang,
        params,
      })
    } catch (error) {
      await this.prisma.policyExpiryNotice.update({
        where: { id },
        data: { status: FAILED, error: describeFailure(error) },
      })
      return
    }

    try {
      const conversationId = await this.delivery.recordInChat(
        { waId, producerId: notice.producerId, producerCodeId: notice.producerCodeId, clientId: notice.clientId },
        existing,
        phoneNumberId,
        renderExpiryNotice(params),
        { policyExpiryNoticeId: notice.id, notice: 'policy_expiry' },
      )
      await this.prisma.policyExpiryNotice.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: null, conversationId },
      })
    } catch (error) {
      // WhatsApp already took it: it must not look unsent and go out twice.
      this.logger.error(
        `Aviso de póliza vencida ${id} enviado pero no guardado en el chat: ${(error as Error).message}`,
      )
      await this.prisma.policyExpiryNotice.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: 'Se envió, pero no quedó registrado en el chat del panel.' },
      })
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async findInScope(id: number, producerId: number, codeIds: number[]) {
    const policy = await this.prisma.policy.findFirst({
      where: { id, producerId, deletedAt: null, producerCodeId: { in: codeIds } },
      select: { id: true },
    })
    if (!policy) throw new NotFoundException(`Policy ${id} not found`)
    return policy
  }

  /** Expired within the year, not cancelled, of the codes and medio de pago in scope. */
  private scopeWhere(
    producerId: number,
    codeIds: number[],
    query: Pick<ListExpiredPoliciesDto, 'paymentMethod' | 'search'>,
    now: Date,
  ): Prisma.PolicyWhereInput {
    const where: Prisma.PolicyWhereInput = {
      producerId,
      deletedAt: null,
      producerCodeId: { in: codeIds },
      ...notCancelledPolizaWhere(),
      validTo: { lt: now, gte: new Date(now.getTime() - MAX_DAYS_EXPIRED * DAY_MS) },
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    }

    const search = query.search?.trim()
    if (search) {
      where.AND = search
        .split(/\s+/)
        .filter(Boolean)
        .map(word => ({
          OR: [
            { certificateNumber: { contains: word } },
            { vehicle: { licensePlate: { contains: word } } },
            {
              client: {
                OR: [{ firstName: { contains: word } }, { lastName: { contains: word } }, { dni: { contains: word } }],
              },
            },
          ],
        }))
    }
    return where
  }

  /**
   * What these clients still have running (in force or about to start): a
   * policy on the same plate, or on the same kind of risk when there is no
   * plate, means the expired one was renewed under a new certificate.
   */
  private async renewedKeys(producerId: number, clientIds: number[], now: Date): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set()
    const current = await this.prisma.policy.findMany({
      where: {
        producerId,
        deletedAt: null,
        clientId: { in: [...new Set(clientIds)] },
        validTo: { gte: now },
        ...notCancelledPolizaWhere(),
      },
      select: { clientId: true, riskType: true, vehicle: { select: { licensePlate: true } } },
    })
    return new Set(current.map(p => renewalKey(p.clientId, p.vehicle?.licensePlate, p.riskType)))
  }

  private toRow(p: PolicyRow, now: Date) {
    const vehicle = p.vehicle
    const vehicleLabel = vehicle ? [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || null : null
    const notice = p.expiryNotices[0]
    return {
      id: p.id,
      certificateNumber: p.certificateNumber,
      riskType: p.riskType,
      product: productNameOf(p.riskType, p.rawData),
      licensePlate: vehicle?.licensePlate ?? null,
      vehicle: vehicleLabel,
      validTo: p.validTo?.toISOString() ?? null,
      daysExpired: p.validTo ? Math.floor((now.getTime() - p.validTo.getTime()) / DAY_MS) : 0,
      paymentMethod: p.paymentMethod,
      producerCode: p.producerCode,
      client: p.client,
      unpaidInstallments: p.installments.length,
      hiddenAt: p.hiddenAt?.toISOString() ?? null,
      hiddenReason: p.hiddenReason,
      notice: notice
        ? {
            id: notice.id,
            status: notice.status,
            sentAt: notice.sentAt?.toISOString() ?? null,
            createdAt: notice.createdAt.toISOString(),
            error: notice.error,
          }
        : null,
    }
  }
}

function renewalKey(clientId: number, licensePlate: string | null | undefined, riskType: string): string {
  const plate = licensePlate?.replace(/\s+/g, '').toUpperCase()
  return plate ? `${clientId}:plate:${plate}` : `${clientId}:risk:${riskType}`
}
