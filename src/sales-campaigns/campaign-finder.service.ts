import { Injectable } from '@nestjs/common'
import { LeadStatus, Prisma, RiskType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ChatScope, visibleNumbers } from '../common/scope/scope.service'
import { inForcePolizaWhere, notCancelledPolizaWhere } from '../common/poliza-vigencia'
import { productNameOf } from '../common/poliza-detail'
import {
  CampaignDefinition,
  CampaignSettings,
  CancellationReason,
  codesSetting,
  CrossSellProduct,
  GAP_LABELS,
  numberSetting,
} from './campaign-catalog'
import { coverageGaps, lowestInstallment } from './coverage-gaps'

const DAY_MS = 86_400_000

/**
 * Whose clients a user works in the campaigns: the policies of their codes
 * and, for what came through WhatsApp (the bot's quotes), only the chats of
 * their own numbers (`chats`, see ChatScope). A branch never sees, writes to
 * or counts the people who talked to another branch's number.
 */
export interface CampaignScope {
  codeIds: number[]
  chats: ChatScope
}

/** Someone a campaign would write to, with what the message and the panel need. */
export interface CampaignTarget {
  /** The policy (the quote for QUOTE_FOLLOWUP): what the panel sends, marks or leaves out. */
  id: number
  clientId: number | null
  name: string
  /** As the message greets them ("Juan"). */
  firstName: string
  dni: string | null
  /** The phone to resolve to WhatsApp (policies), or null when the WhatsApp id is known. */
  phone: string | null
  /** Known WhatsApp id: the bot chat of a quote. */
  waId: string | null
  conversationId: number | null
  /** For the list: "Ford Ka 2015 · AB123CD". */
  item: string
  /** For the message ({bien}): "Ford Ka". */
  bien: string
  detail: string
  date: Date | null
  /**
   * What "más recientes" sorts by: when the person entered the list. The
   * policy's start (coverage upgrade, cross-sell), its end (renewal), the
   * cancellation (winback) or the quote.
   */
  sortDate: Date | null
  /** Coverage codes of the vehicle ("A", "C2 Full"); in CROSS_SELL, of every car or motorbike in force. */
  coverages: string[]
  /** WINBACK: why Triunfo cancelled the policy, or that it ran out unrenewed. */
  reason: CancellationReason | null
  /**
   * What the client lacks: protections of the vehicle's coverage or its insured
   * sum (COVERAGE_UPGRADE), products they do not have (CROSS_SELL).
   */
  gaps: string[]
  /** QUOTE_FOLLOWUP: the lowest instalment the quote offered, and who quoted it. */
  amount: number | null
  company: string | null
  producerCodeId: number | null
  producerCode: { id: number; code: string } | null
}

const RISK_LABELS: Record<string, string> = {
  auto: 'auto',
  moto: 'moto',
  life: 'seguro de vida',
  home: 'hogar',
  commercial: 'comercio',
  other: 'seguro',
}

/** The risk types that count as having each product Venta cruzada offers. */
export const PRODUCT_RISKS: Record<CrossSellProduct, RiskType[]> = {
  home: [RiskType.home],
  life: [RiskType.life],
  vehicle: [RiskType.auto, RiskType.moto],
  commercial: [RiskType.commercial],
}

/** Each product as the list's reason names it, in a few letters. */
const PRODUCT_SHORT: Record<CrossSellProduct, string> = {
  home: 'hogar',
  life: 'vida',
  vehicle: 'auto o moto',
  commercial: 'comercio',
}

/** Every quote stored today is Triunfo's (Quote has no company of its own yet). */
const QUOTE_COMPANY = 'Triunfo'

/** Cancellations that do not lose the client: the policy was replaced or issued by mistake. */
const NOT_A_LOSS = ['ANULA POR REEMPLAZO', 'ANULA POR ERROR']

/**
 * Why a policy was cancelled, by the start of Triunfo's movement (production,
 * 2026-11: "ANULA COBRANZA", "ANULA POR VENTA", "ANULA DESISTIM.ASEG.",
 * "ANULA P/ MOTIVOS VS.", "RESCISION UNILATERAL"…). Anything else is "otros".
 */
const CANCELLATIONS: Array<{ prefix: string; reason: CancellationReason; detail: string }> = [
  { prefix: 'ANULA COBRANZA', reason: 'falta_pago', detail: 'por falta de pago' },
  { prefix: 'ANULA POR VENTA', reason: 'venta', detail: 'por venta del bien' },
  { prefix: 'ANULA DESISTIM', reason: 'desistimiento', detail: 'la pidió el asegurado' },
  { prefix: 'ANULA P/AUMEN', reason: 'costo', detail: 'por aumento de costo' },
  { prefix: 'ANUL.P/CAMBIO DE CIA', reason: 'cambio_compania', detail: 'por cambio de compañía' },
  { prefix: 'ANULA POR SINIESTRO', reason: 'siniestro', detail: 'por siniestro' },
  { prefix: 'ANULA STRO', reason: 'siniestro', detail: 'por un siniestro de la póliza anterior' },
  { prefix: 'RESCISION', reason: 'rescision', detail: 'rescindida' },
  { prefix: 'ANULA P/ MOTIVOS', reason: 'otros', detail: 'por motivos varios' },
  { prefix: 'ANUL.CANCEL.PRENDA', reason: 'otros', detail: 'por cancelación de la prenda' },
]

const POLICY_SELECT = {
  id: true,
  clientId: true,
  riskType: true,
  validFrom: true,
  validTo: true,
  lastMovement: true,
  rawData: true,
  updatedAt: true,
  producerCodeId: true,
  producerCode: { select: { id: true, code: true } },
  client: { select: { id: true, firstName: true, lastName: true, dni: true, phone: true, deletedAt: true } },
  vehicle: { select: { licensePlate: true, brand: true, model: true, year: true, coverage: true, sumInsured: true } },
} satisfies Prisma.PolicySelect

type PolicyRow = Prisma.PolicyGetPayload<{ select: typeof POLICY_SELECT }>

/**
 * Who each campaign writes to, read from the organization's portfolio (the
 * Triunfo policies the sync keeps) and, for QUOTE_FOLLOWUP, from the bot's
 * quotes. `ids` narrows to the policies or quotes the office ticked.
 */
@Injectable()
export class CampaignFinderService {
  constructor(private readonly prisma: PrismaService) {}

  find(
    definition: CampaignDefinition,
    settings: CampaignSettings,
    producerId: number,
    scope: CampaignScope,
    now = new Date(),
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const codeIds = scope.codeIds
    switch (definition.kind) {
      case 'coverage_upgrade':
        return this.coverageUpgrade(settings, producerId, codeIds, now, ids)
      case 'quote_followup':
        return this.quoteFollowup(settings, producerId, scope, now, ids)
      case 'renewal':
        return this.renewal(settings, producerId, codeIds, now, ids)
      case 'winback':
        return this.winback(settings, producerId, codeIds, now, ids)
      case 'cross_sell':
        return this.crossSell(settings, producerId, codeIds, now, ids)
    }
  }

  /**
   * The bot quotes a user sees: those asked through one of the numbers of
   * their codes that they may see (an admin, their own numbers; the SuperAdmin,
   * every number or the one they filtered by). The number is the quote's own;
   * an older quote without one takes its chat's. The organization's default
   * number also brings the quotes that came through no number: older chats and
   * the web's.
   */
  async quoteOrigin(producerId: number, scope: CampaignScope): Promise<Prisma.QuoteWhereInput> {
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null, responsibleProducerCodeId: { in: scope.codeIds } },
      select: { phoneNumberId: true },
    })
    const visible = visibleNumbers(scope.chats)
    const metaIds = numbers.map(n => n.phoneNumberId).filter(id => visible === null || visible.includes(id))
    const withNone = scope.chats.defaultNumber != null && metaIds.includes(scope.chats.defaultNumber)
    return {
      OR: [
        { phoneNumberId: { in: metaIds } },
        { phoneNumberId: null, conversation: { phoneNumberId: { in: metaIds } } },
        // No number at all: an older chat, or a quote asked on the web.
        ...(withNone
          ? [
              { phoneNumberId: null, conversation: { phoneNumberId: null } },
              { phoneNumberId: null, conversationId: null },
            ]
          : []),
      ],
    }
  }

  /**
   * A car or motorbike in force on one of the coverages the organization counts
   * as basic or, when it reviews insured sums, insured for less than its
   * threshold. Each one says what its coverage leaves out.
   */
  private async coverageUpgrade(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const basic = codesSetting(settings, 'basicCoverages')
    const sumBelow = numberSetting(settings, 'reviewSumBelow')
    if (!basic.length && !sumBelow) return []
    const policies = await this.policies(
      {
        ...this.scope(producerId, codeIds, ids),
        ...inForcePolizaWhere(now),
        riskType: { in: [RiskType.auto, RiskType.moto] },
        vehicle: {
          OR: [
            ...(basic.length ? [{ coverage: { in: basic } }] : []),
            ...(sumBelow ? [{ sumInsured: { gt: 0, lt: sumBelow } }] : []),
          ],
        },
      },
      now,
    )
    return policies.map(p => {
      const sum = p.vehicle?.sumInsured == null ? 0 : Number(p.vehicle.sumInsured)
      const lowSum = sumBelow > 0 && sum > 0 && sum < sumBelow
      const missing = coverageGaps(coverageOf(p), p.riskType === RiskType.moto)
      const coverage = [
        `Cobertura ${coverageOf(p) ?? ''}`.trim(),
        missing.length ? `(sin ${listOf(missing.map(g => GAP_LABELS[g].toLowerCase()))})` : '',
      ]
        .filter(Boolean)
        .join(' ')
      const detail = [coverage, lowSum ? `suma asegurada ${money(sum)}` : '', since(p)].filter(Boolean).join(' · ')
      return policyTarget(p, detail, p.validTo, {
        sortDate: p.validFrom,
        gaps: [...missing, ...(lowSum ? ['suma'] : [])],
      })
    })
  }

  /** A policy in force that ends within `daysBefore` and has no renewal issued yet. */
  private async renewal(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const until = new Date(now.getTime() + numberSetting(settings, 'daysBefore') * DAY_MS)
    const policies = await this.policies(
      { ...this.scope(producerId, codeIds, ids), AND: [inForcePolizaWhere(now), { validTo: { lte: until } }] },
      now,
    )
    const later = await this.runningPolicies(
      producerId,
      policies.map(p => p.clientId),
      now,
    )
    return policies
      .filter(p => !later.some(o => o.id !== p.id && o.key === keyOf(p) && o.validTo > (p.validTo ?? now)))
      .map(p => policyTarget(p, `Vence el ${formatDay(p.validTo)}`, p.validTo, { sortDate: p.validTo }))
  }

  /**
   * A policy cancelled within `withinDays` (not replaced, not issued by
   * mistake), or that ran out in that time and nobody renewed (unless the
   * office hid it from "pólizas vencidas": it knows it is gone for good), whose
   * client has nothing running on the same vehicle or risk.
   */
  private async winback(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const since = new Date(now.getTime() - numberSetting(settings, 'withinDays') * DAY_MS)
    const policies = await this.policies(
      {
        ...this.scope(producerId, codeIds, ids),
        deletedAt: null,
        OR: [{ lastMovement: { startsWith: 'ANUL' } }, { lastMovement: { startsWith: 'RESCISION' } }],
        NOT: NOT_A_LOSS.map(prefix => ({ lastMovement: { startsWith: prefix } })),
        // A cancelled policy keeps its end date: one that ended over a year before the window is old news.
        validTo: { gte: new Date(since.getTime() - 366 * DAY_MS) },
      },
      now,
    )
    const expired = await this.policies(
      {
        ...this.scope(producerId, codeIds, ids),
        deletedAt: null,
        hiddenAt: null,
        validTo: { gte: since, lt: now },
        ...notCancelledPolizaWhere(),
      },
      now,
    )
    const cancelled = [
      ...policies
        .map(p => ({ policy: p, at: cancelledAt(p), expired: false }))
        .filter(({ at }) => at >= since && at <= now),
      ...expired.map(p => ({ policy: p, at: p.validTo ?? now, expired: true })),
    ]
    const running = await this.runningPolicies(
      producerId,
      cancelled.map(c => c.policy.clientId),
      now,
    )
    const runningKeys = new Set(running.map(r => r.key))
    // One per vehicle or risk: the latest cancellation.
    const latest = new Map<string, (typeof cancelled)[number]>()
    for (const c of cancelled) {
      const key = keyOf(c.policy)
      if (runningKeys.has(key)) continue
      const seen = latest.get(key)
      if (!seen || seen.at < c.at) latest.set(key, c)
    }
    return [...latest.values()].map(({ policy, at, expired }) => {
      if (expired) {
        return policyTarget(policy, `Venció el ${formatDay(at)} y no se renovó`, at, {
          sortDate: at,
          reason: 'no_renovada',
        })
      }
      const movement = policy.lastMovement.trim().toUpperCase()
      const why = CANCELLATIONS.find(c => movement.startsWith(c.prefix))
      return policyTarget(policy, `Anulada el ${formatDay(at)}${why ? ` (${why.detail})` : ''}`, at, {
        sortDate: at,
        reason: why?.reason ?? 'otros',
      })
    })
  }

  /**
   * A client with something in force who lacks one of the products the
   * organization offers (`offer`: home, life, a vehicle, commerce): one row per
   * client, showing the policy that started last and what they lack. The filter
   * by coverage reads all their vehicles (a car on A and a motorbike on C).
   */
  private async crossSell(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const offer = codesSetting(settings, 'offer') as CrossSellProduct[]
    if (!offer.length) return []
    const policies = await this.policies({ ...this.scope(producerId, codeIds, ids), ...inForcePolizaWhere(now) }, now)
    // What each client has in force in the whole organization, not only in these codes.
    const inForce = await this.prisma.policy.findMany({
      where: {
        producerId,
        clientId: { in: [...new Set(policies.map(p => p.clientId))] },
        ...inForcePolizaWhere(now),
      },
      select: { clientId: true, riskType: true },
    })
    const has = new Map<number, Set<RiskType>>()
    for (const p of [...policies, ...inForce]) {
      has.set(p.clientId, (has.get(p.clientId) ?? new Set<RiskType>()).add(p.riskType))
    }
    const lacks = (clientId: number) =>
      offer.filter(product => !PRODUCT_RISKS[product].some(risk => has.get(clientId)?.has(risk)))

    const byClient = new Map<number, PolicyRow>()
    const coveragesByClient = new Map<number, Set<string>>()
    for (const p of policies) {
      if (!lacks(p.clientId).length) continue
      const coverage = coverageOf(p)
      if (coverage) coveragesByClient.set(p.clientId, (coveragesByClient.get(p.clientId) ?? new Set()).add(coverage))
      const seen = byClient.get(p.clientId)
      if (!seen || startOf(seen, now) < startOf(p, now)) byClient.set(p.clientId, p)
    }
    return [...byClient.values()].map(p => {
      const missing = lacks(p.clientId)
      const owned = listOf([...new Set([...(has.get(p.clientId) ?? [])].map(risk => RISK_LABELS[risk] ?? risk))])
      const detail = [`Tiene ${owned}`, `le falta: ${missing.map(g => PRODUCT_SHORT[g]).join(', ')}`, since(p)]
        .filter(Boolean)
        .join(' · ')
      return policyTarget(p, detail, p.validTo, {
        sortDate: p.validFrom,
        coverages: [...(coveragesByClient.get(p.clientId) ?? [])],
        gaps: missing,
      })
    })
  }

  /**
   * A quote between `afterDays` and `withinDays` old that did not end in a
   * policy: one asked to the bot that nobody asked to contract, or one (the
   * bot's or the web's) whose request to contract the office has not closed.
   * One per person (the chat, or the document of the request): the latest.
   */
  private async quoteFollowup(
    settings: CampaignSettings,
    producerId: number,
    scope: CampaignScope,
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    // By the number the person wrote to, never by the quote's code: the bot
    // credits every quote to the organization's master code, whatever the branch.
    const origin = await this.quoteOrigin(producerId, scope)
    const quotes = await this.prisma.quote.findMany({
      where: {
        producerId,
        deletedAt: null,
        createdAt: {
          gte: new Date(now.getTime() - numberSetting(settings, 'withinDays') * DAY_MS),
          lte: new Date(now.getTime() - numberSetting(settings, 'afterDays') * DAY_MS),
        },
        AND: [origin, { OR: [{ conversationId: { not: null } }, { quoteRequest: { isNot: null } }] }],
        ...(ids ? { id: { in: ids } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        vehicleType: true,
        vehicleLabel: true,
        manufactureYear: true,
        result: true,
        producerCodeId: true,
        producerCode: { select: { id: true, code: true } },
        quoteRequest: {
          select: {
            status: true,
            selectedCoverage: true,
            applicantFirstName: true,
            applicantLastName: true,
            applicantPhone: true,
            applicantDocNumber: true,
            createdAt: true,
            deletedAt: true,
          },
        },
        conversation: {
          select: {
            id: true,
            waId: true,
            contactName: true,
            contactNameManual: true,
            clientId: true,
            client: { select: { id: true, firstName: true, lastName: true, dni: true } },
          },
        },
      },
    })
    type QuoteRow = (typeof quotes)[number]
    const requestOf = (q: QuoteRow) => (q.quoteRequest && !q.quoteRequest.deletedAt ? q.quoteRequest : null)
    const documentOf = (q: QuoteRow) => requestOf(q)?.applicantDocNumber.replace(/\D/g, '') || null
    const latest = new Map<string, QuoteRow>()
    for (const q of quotes) {
      const key = q.conversation ? `chat:${q.conversation.id}` : `doc:${documentOf(q) ?? q.id}`
      if (!latest.has(key)) latest.set(key, q)
    }
    // The person's latest quote is the one that counts: a request the office closed ends it.
    const open = [...latest.values()].filter(q => requestOf(q)?.status !== LeadStatus.CLOSED)

    const documents = [
      ...new Set(open.flatMap(q => (!q.conversation?.clientId && documentOf(q) ? [documentOf(q)!] : []))),
    ]
    const byDocument = documents.length
      ? await this.prisma.client.findMany({
          where: { producerId, deletedAt: null, dni: { in: documents } },
          select: { id: true, dni: true },
        })
      : []
    const clientIdOf = (q: QuoteRow) =>
      q.conversation?.clientId ?? byDocument.find(c => c.dni === documentOf(q))?.id ?? null
    const clientIds = [...new Set(open.flatMap(q => (clientIdOf(q) != null ? [clientIdOf(q)!] : [])))]
    const contracted = clientIds.length
      ? await this.prisma.policy.findMany({
          where: { producerId, clientId: { in: clientIds }, deletedAt: null },
          select: { clientId: true, createdAt: true },
        })
      : []
    return open
      .filter(q => !contracted.some(p => p.clientId === clientIdOf(q) && p.createdAt >= q.createdAt))
      .map(q => {
        const chat = q.conversation
        const request = requestOf(q)
        const contact = chat?.contactNameManual || chat?.contactName || ''
        const applicant = request ? fullName(request.applicantFirstName, request.applicantLastName) : ''
        const name = chat?.client
          ? fullName(chat.client.firstName, chat.client.lastName)
          : applicant || contact || 'Sin nombre'
        const vehicle = q.vehicleLabel || (q.vehicleType === 'MOTO' ? 'moto' : 'auto')
        const amount = lowestInstallment(q.result)
        const what = request
          ? `Pidió contratar el ${formatDate(request.createdAt)} (cobertura ${request.selectedCoverage}) y no tiene póliza`
          : `Cotizó el ${formatDate(q.createdAt)}`
        return {
          id: q.id,
          clientId: clientIdOf(q),
          name,
          firstName: greetingName(chat?.client?.firstName || request?.applicantFirstName || contact),
          dni: chat?.client?.dni ?? documentOf(q),
          phone: chat ? null : (request?.applicantPhone ?? null),
          waId: chat?.waId ?? null,
          conversationId: chat?.id ?? null,
          item: [q.vehicleLabel ? titleCase(q.vehicleLabel) : vehicle, q.manufactureYear].filter(Boolean).join(' '),
          bien: q.vehicleLabel ? shortVehicle(q.vehicleLabel) : vehicle,
          detail: [what, QUOTE_COMPANY, amount ? `cuotas desde ${money(amount)}` : ''].filter(Boolean).join(' · '),
          date: q.createdAt,
          sortDate: q.createdAt,
          coverages: [],
          reason: null,
          gaps: [],
          amount,
          company: QUOTE_COMPANY,
          producerCodeId: q.producerCodeId,
          producerCode: q.producerCode,
        }
      })
  }

  // ─── Helpers ───────────────────────────────────────────

  private scope(producerId: number, codeIds: number[], ids?: number[]): Prisma.PolicyWhereInput {
    return { producerId, producerCodeId: { in: codeIds }, ...(ids ? { id: { in: ids } } : {}) }
  }

  /** Policies of clients still in the portfolio with a phone to write to. */
  private async policies(where: Prisma.PolicyWhereInput, _now: Date): Promise<PolicyRow[]> {
    return this.prisma.policy.findMany({
      where: { ...where, client: { deletedAt: null, phone: { not: null } } },
      select: POLICY_SELECT,
    })
  }

  /** What these clients have in force or about to start, by vehicle or risk. */
  private async runningPolicies(producerId: number, clientIds: number[], now: Date) {
    if (!clientIds.length) return []
    const rows = await this.prisma.policy.findMany({
      where: {
        producerId,
        deletedAt: null,
        clientId: { in: [...new Set(clientIds)] },
        validTo: { gte: now },
        ...notCancelledPolizaWhere(),
      },
      select: { id: true, clientId: true, riskType: true, validTo: true, vehicle: { select: { licensePlate: true } } },
    })
    return rows.map(r => ({ id: r.id, key: keyOf(r), validTo: r.validTo ?? now }))
  }
}

function policyTarget(
  p: PolicyRow,
  detail: string,
  date: Date | null,
  extra: { sortDate: Date | null; coverages?: string[]; reason?: CancellationReason; gaps?: string[] },
): CampaignTarget {
  const vehicle = p.vehicle
  const vehicleName = vehicle ? [vehicle.brand, vehicle.model].filter(Boolean).join(' ') : ''
  const product = productNameOf(p.riskType, p.rawData)
  const item = vehicle
    ? [titleCase([vehicleName, vehicle.year].filter(Boolean).join(' ')), vehicle.licensePlate]
        .filter(Boolean)
        .join(' · ')
    : product || RISK_LABELS[p.riskType] || p.riskType
  const bien = vehicleName
    ? shortVehicle(vehicleName)
    : vehicle?.licensePlate || product || RISK_LABELS[p.riskType] || 'seguro'
  return {
    id: p.id,
    clientId: p.clientId,
    name: fullName(p.client.firstName, p.client.lastName),
    firstName: greetingName(p.client.firstName),
    dni: p.client.dni,
    phone: p.client.phone,
    waId: null,
    conversationId: null,
    item: item || 'Póliza',
    bien,
    detail,
    date,
    sortDate: extra.sortDate,
    coverages: extra.coverages ?? (coverageOf(p) ? [coverageOf(p)!] : []),
    reason: extra.reason ?? null,
    gaps: extra.gaps ?? [],
    amount: null,
    company: null,
    producerCodeId: p.producerCodeId,
    producerCode: p.producerCode,
  }
}

/** "granizo, cristales y robo": a list as a person says it. */
function listOf(items: string[]): string {
  if (items.length < 2) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** "$ 3.200.000": pesos without cents. */
function money(value: number): string {
  return `$ ${Math.round(value).toLocaleString('es-AR')}`
}

/** The vehicle's coverage code as Triunfo writes it ("A", "C2 Full"), or null. */
function coverageOf(p: PolicyRow): string | null {
  return p.vehicle?.coverage?.trim() || null
}

/** When the policy's current term started: what "más recientes" sorts a policy by. */
function startOf(p: PolicyRow, now: Date): Date {
  return p.validFrom ?? p.validTo ?? now
}

/** "vigente desde 04/11/2026", so the order by recent policies shows. */
function since(p: PolicyRow): string {
  return p.validFrom ? `vigente desde ${formatDay(p.validFrom)}` : ''
}

/** The same vehicle (by plate) or, without one, the same kind of risk of the same client. */
function keyOf(p: { clientId: number; riskType: string; vehicle?: { licensePlate: string | null } | null }): string {
  const plate = p.vehicle?.licensePlate?.replace(/\s+/g, '').toUpperCase()
  return plate ? `${p.clientId}:plate:${plate}` : `${p.clientId}:risk:${p.riskType}`
}

/**
 * When Triunfo cancelled it: the issue date of its last movement (the
 * cancellation), else when the sync last changed the policy.
 */
function cancelledAt(p: PolicyRow): Date {
  const raw = p.rawData && typeof p.rawData === 'object' ? (p.rawData as Record<string, unknown>) : {}
  const issued = typeof raw.FechaEmision === 'string' ? raw.FechaEmision : ''
  const date = /^\d{4}-\d{2}-\d{2}/.test(issued) ? new Date(`${issued.slice(0, 10)}T12:00:00Z`) : null
  return date && !Number.isNaN(date.getTime()) ? date : p.updatedAt
}

function fullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return titleCase([firstName, lastName].filter(Boolean).join(' ')) || 'Sin nombre'
}

/** The first name the message greets; "qué tal" when there is none ("¡Hola, qué tal!"). */
function greetingName(firstName: string | null | undefined): string {
  const first = (firstName ?? '').trim().split(/\s+/)[0]
  return first ? titleCase(first) : 'qué tal'
}

/** Brand and model, as a person says it: "FORD KA 1.5 SE" → "Ford Ka". */
function shortVehicle(label: string): string {
  return titleCase(label.split(/\s+/).slice(0, 2).join(' '))
}

export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase())
}

/** dd/mm/yyyy of a policy date: Triunfo's dates are days, stored at UTC midnight. */
export function formatDay(date: Date | null): string {
  if (!date) return ''
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

/** dd/mm/yyyy of a moment, in Argentina (when a quote was asked). */
export function formatDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
