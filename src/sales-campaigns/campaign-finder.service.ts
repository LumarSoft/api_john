import { Injectable } from '@nestjs/common'
import { Prisma, RiskType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { inForcePolizaWhere, notCancelledPolizaWhere } from '../common/poliza-vigencia'
import { productNameOf } from '../common/poliza-detail'
import {
  CampaignDefinition,
  CampaignSettings,
  CancellationReason,
  codesSetting,
  numberSetting,
} from './campaign-catalog'

const DAY_MS = 86_400_000

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
  /** WINBACK: why Triunfo cancelled the policy. */
  reason: CancellationReason | null
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
  vehicle: { select: { licensePlate: true, brand: true, model: true, year: true, coverage: true } },
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
    codeIds: number[],
    now = new Date(),
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    switch (definition.kind) {
      case 'coverage_upgrade':
        return this.coverageUpgrade(settings, producerId, codeIds, now, ids)
      case 'quote_followup':
        return this.quoteFollowup(settings, producerId, codeIds, now, ids)
      case 'renewal':
        return this.renewal(settings, producerId, codeIds, now, ids)
      case 'winback':
        return this.winback(settings, producerId, codeIds, now, ids)
      case 'cross_sell':
        return this.crossSell(producerId, codeIds, now, ids)
    }
  }

  /** A car or motorbike in force on one of the coverages the organization counts as basic. */
  private async coverageUpgrade(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const basic = codesSetting(settings, 'basicCoverages')
    if (!basic.length) return []
    const policies = await this.policies(
      {
        ...this.scope(producerId, codeIds, ids),
        ...inForcePolizaWhere(now),
        riskType: { in: [RiskType.auto, RiskType.moto] },
        vehicle: { coverage: { in: basic } },
      },
      now,
    )
    return policies.map(p =>
      policyTarget(p, [`Cobertura ${coverageOf(p) ?? ''}`.trim(), since(p)].filter(Boolean).join(' · '), p.validTo, {
        sortDate: p.validFrom,
      }),
    )
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
   * mistake) whose client has nothing running on the same vehicle or risk.
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
    const cancelled = policies
      .map(p => ({ policy: p, at: cancelledAt(p) }))
      .filter(({ at }) => at >= since && at <= now)
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
    return [...latest.values()].map(({ policy, at }) => {
      const movement = policy.lastMovement.trim().toUpperCase()
      const why = CANCELLATIONS.find(c => movement.startsWith(c.prefix))
      return policyTarget(policy, `Anulada el ${formatDay(at)}${why ? ` (${why.detail})` : ''}`, at, {
        sortDate: at,
        reason: why?.reason ?? 'otros',
      })
    })
  }

  /**
   * A client with a car or motorbike in force and no home policy in force: one
   * row per client, showing the policy that started last. The filter by
   * coverage reads all of them (a client with a car on A and a motorbike on C).
   */
  private async crossSell(producerId: number, codeIds: number[], now: Date, ids?: number[]): Promise<CampaignTarget[]> {
    const policies = await this.policies(
      {
        ...this.scope(producerId, codeIds, ids),
        ...inForcePolizaWhere(now),
        riskType: { in: [RiskType.auto, RiskType.moto] },
      },
      now,
    )
    const withHome = await this.prisma.policy.findMany({
      where: {
        producerId,
        clientId: { in: [...new Set(policies.map(p => p.clientId))] },
        riskType: RiskType.home,
        ...inForcePolizaWhere(now),
      },
      select: { clientId: true },
    })
    const hasHome = new Set(withHome.map(h => h.clientId))
    const byClient = new Map<number, PolicyRow>()
    const coveragesByClient = new Map<number, Set<string>>()
    for (const p of policies) {
      if (hasHome.has(p.clientId)) continue
      const coverage = coverageOf(p)
      if (coverage) coveragesByClient.set(p.clientId, (coveragesByClient.get(p.clientId) ?? new Set()).add(coverage))
      const seen = byClient.get(p.clientId)
      if (!seen || startOf(seen, now) < startOf(p, now)) byClient.set(p.clientId, p)
    }
    return [...byClient.values()].map(p => {
      const coverage = coverageOf(p)
      const risk = `Tiene seguro de ${RISK_LABELS[p.riskType] ?? p.riskType}${coverage ? ` (cobertura ${coverage})` : ''}`
      return policyTarget(p, [`${risk}, no de hogar`, since(p)].filter(Boolean).join(' · '), p.validTo, {
        sortDate: p.validFrom,
        coverages: [...(coveragesByClient.get(p.clientId) ?? [])],
      })
    })
  }

  /**
   * A bot quote between `afterDays` and `withinDays` old that nobody asked to
   * contract (no request) and whose chat did not get a policy afterwards. One
   * per chat: the latest quote.
   */
  private async quoteFollowup(
    settings: CampaignSettings,
    producerId: number,
    codeIds: number[],
    now: Date,
    ids?: number[],
  ): Promise<CampaignTarget[]> {
    const numbersInScope = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null, responsibleProducerCodeId: { in: codeIds } },
      select: { phoneNumberId: true },
    })
    const quotes = await this.prisma.quote.findMany({
      where: {
        producerId,
        deletedAt: null,
        conversationId: { not: null },
        quoteRequest: { is: null },
        createdAt: {
          gte: new Date(now.getTime() - numberSetting(settings, 'withinDays') * DAY_MS),
          lte: new Date(now.getTime() - numberSetting(settings, 'afterDays') * DAY_MS),
        },
        OR: [{ producerCodeId: { in: codeIds } }, { phoneNumberId: { in: numbersInScope.map(n => n.phoneNumberId) } }],
        ...(ids ? { id: { in: ids } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        vehicleType: true,
        vehicleLabel: true,
        manufactureYear: true,
        producerCodeId: true,
        producerCode: { select: { id: true, code: true } },
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
    const latest = new Map<number, (typeof quotes)[number]>()
    for (const q of quotes) {
      if (q.conversation && !latest.has(q.conversation.id)) latest.set(q.conversation.id, q)
    }
    const clientIds = [...latest.values()].flatMap(q => (q.conversation?.clientId ? [q.conversation.clientId] : []))
    const contracted = clientIds.length
      ? await this.prisma.policy.findMany({
          where: { producerId, clientId: { in: clientIds }, deletedAt: null },
          select: { clientId: true, createdAt: true },
        })
      : []
    return [...latest.values()]
      .filter(q => !contracted.some(p => p.clientId === q.conversation!.clientId && p.createdAt >= q.createdAt))
      .map(q => {
        const chat = q.conversation!
        const contact = chat.contactNameManual || chat.contactName || ''
        const name = chat.client ? fullName(chat.client.firstName, chat.client.lastName) : contact || 'Sin nombre'
        const vehicle = q.vehicleLabel || (q.vehicleType === 'MOTO' ? 'moto' : 'auto')
        return {
          id: q.id,
          clientId: chat.clientId,
          name,
          firstName: greetingName(chat.client?.firstName || contact),
          dni: chat.client?.dni ?? null,
          phone: null,
          waId: chat.waId,
          conversationId: chat.id,
          item: [q.vehicleLabel ? titleCase(q.vehicleLabel) : vehicle, q.manufactureYear].filter(Boolean).join(' '),
          bien: q.vehicleLabel ? shortVehicle(q.vehicleLabel) : vehicle,
          detail: `Cotizó el ${formatDate(q.createdAt)}`,
          date: q.createdAt,
          sortDate: q.createdAt,
          coverages: [],
          reason: null,
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
  extra: { sortDate: Date | null; coverages?: string[]; reason?: CancellationReason },
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
    producerCodeId: p.producerCodeId,
    producerCode: p.producerCode,
  }
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
