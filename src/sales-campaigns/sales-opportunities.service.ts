import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma, Role, SalesOpportunityLostReason, SalesOpportunityStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeUser } from '../common/scope/scope.service'
import { notCancelledPolizaWhere } from '../common/poliza-vigencia'
import {
  CAMPAIGNS,
  CampaignDefinition,
  CampaignSettings,
  campaignOfDbKind,
  codesSetting,
  CrossSellProduct,
  settingsOf,
} from './campaign-catalog'
import { CampaignFinderService, CampaignScope, CampaignTarget, PRODUCT_RISKS } from './campaign-finder.service'
import { isOptOutRequest } from './campaign-follow-up'
import { coverageRank } from './coverage-gaps'
import type { CampaignResultsDto } from './dto/campaign-results.dto'
import type { UpdateOpportunityDto } from './dto/update-opportunity.dto'

const { NEW, CONTACTED, REPLIED, QUOTED, WON, LOST } = SalesOpportunityStatus
/** Still being worked: the tracker looks for what came of these. */
const OPEN: SalesOpportunityStatus[] = [CONTACTED, REPLIED, QUOTED]
/** An opportunity only moves forward on its own; the office is who closes or reopens it. */
const RANK: Record<SalesOpportunityStatus, number> = { NEW: 0, CONTACTED: 1, REPLIED: 2, QUOTED: 3, WON: 4, LOST: 4 }
const DAY_MS = 86_400_000
/** The results run the tracker first when nobody did for this long. */
const TRACK_STALE_MS = 5 * 60_000
const TRACK_BATCH = 500
/** The renewal is the policy that starts within this many days of the old one's end. */
const RENEWAL_WINDOW_DAYS = 45
const DEFAULT_RESULTS_DAYS = 90
/** A "no me escriban más" is read in the customer's first messages after the contact, for this long. */
const OPT_OUT_WINDOW_DAYS = 14
const OPT_OUT_MESSAGES = 10

export const LOST_REASON_LABELS: Record<SalesOpportunityLostReason, string> = {
  PRICE: 'Precio',
  OTHER_INSURER: 'Se fue a otra compañía',
  NO_ANSWER: 'No contesta',
  SOLD_ASSET: 'Vendió el bien',
  OTHER: 'Otro motivo',
}

export const STATUS_LABELS: Record<SalesOpportunityStatus, string> = {
  NEW: 'Sin contactar',
  CONTACTED: 'Contactado',
  REPLIED: 'Respondió',
  QUOTED: 'Cotizado',
  WON: 'Ganada',
  LOST: 'Perdida',
}

/** What the opportunity follows: the campaign's policy, or the quote in QUOTE_FOLLOWUP. */
export function targetKeyOf(definition: CampaignDefinition, targetId: number): string {
  return `${definition.kind === 'quote_followup' ? 'quote' : 'policy'}:${targetId}`
}

const PERSON_SELECT = { id: true, name: true } as const

const OPPORTUNITY_SELECT = {
  id: true,
  targetKey: true,
  status: true,
  contactedAt: true,
  repliedAt: true,
  quotedAt: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
  note: true,
  wonPremium: true,
  assignedAt: true,
  assignedTo: { select: PERSON_SELECT },
  campaignId: true,
  clientId: true,
  producerCodeId: true,
  policyId: true,
  quoteId: true,
} satisfies Prisma.SalesOpportunitySelect

export type OpportunityRow = Prisma.SalesOpportunityGetPayload<{ select: typeof OPPORTUNITY_SELECT }>

/** The opportunity as the panel shows it next to the client. */
export interface OpportunityView {
  id: number
  status: SalesOpportunityStatus
  statusLabel: string
  assignedTo: { id: number; name: string | null } | null
  assignedAt: string | null
  contactedAt: string | null
  repliedAt: string | null
  quotedAt: string | null
  wonAt: string | null
  lostAt: string | null
  lostReason: SalesOpportunityLostReason | null
  lostReasonLabel: string | null
  note: string | null
  wonPremium: number | null
}

export function opportunityView(row: OpportunityRow): OpportunityView {
  const iso = (d: Date | null) => d?.toISOString() ?? null
  return {
    id: row.id,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    assignedTo: row.assignedTo ? { id: row.assignedTo.id, name: row.assignedTo.name } : null,
    assignedAt: iso(row.assignedAt),
    contactedAt: iso(row.contactedAt),
    repliedAt: iso(row.repliedAt),
    quotedAt: iso(row.quotedAt),
    wonAt: iso(row.wonAt),
    lostAt: iso(row.lostAt),
    lostReason: row.lostReason,
    lostReasonLabel: row.lostReason ? LOST_REASON_LABELS[row.lostReason] : null,
    note: row.note,
    wonPremium: row.wonPremium == null ? null : Number(row.wonPremium),
  }
}

/** What the customer told the bot when asking to cancel ("— Motivo: …;" in the baja_poliza notice). */
const CUSTOMER_REASON_RE = /— Motivo: (.+?); pendiente de confirmación/

interface Counts {
  contacted: number
  replied: number
  quoted: number
  won: number
  lost: number
  open: number
  premium: number
}

const emptyCounts = (): Counts => ({ contacted: 0, replied: 0, quoted: 0, won: 0, lost: 0, open: 0, premium: 0 })

function count(
  into: Counts,
  row: {
    status: SalesOpportunityStatus
    repliedAt: Date | null
    quotedAt: Date | null
    wonPremium: Prisma.Decimal | null
  },
) {
  into.contacted++
  if (row.repliedAt) into.replied++
  if (row.quotedAt) into.quoted++
  if (row.status === WON) {
    into.won++
    into.premium += row.wonPremium == null ? 0 : Number(row.wonPremium)
  } else if (row.status === LOST) into.lost++
  else into.open++
}

type OpenRow = Prisma.SalesOpportunityGetPayload<{
  select: {
    id: true
    status: true
    campaignId: true
    producerId: true
    clientId: true
    policyId: true
    quoteId: true
    contactedAt: true
    repliedAt: true
    quotedAt: true
    createdAt: true
    coverageAtContact: true
    campaign: { select: { kind: true; settings: true } }
    policy: {
      select: {
        riskType: true
        validTo: true
        updatedAt: true
        vehicle: { select: { licensePlate: true; coverage: true } }
      }
    }
    quote: { select: { conversationId: true } }
  }
}>

const plateOf = (plate: string | null | undefined) => plate?.replace(/[^A-Z0-9]/gi, '').toUpperCase() || null

/**
 * The opportunities of Nico's proposal: each client a campaign writes to is
 * followed by someone until it ends in a sale or not. The campaign's send or
 * "ya lo contactamos" opens it (assigned to who did it); the tracker moves it
 * forward when it can tell — the customer answered in the chat, a quote came
 * after the contact, the cartera sync brought a new policy — and the office
 * closes it as lost (why) or as won when the sale happened elsewhere. The
 * results count them by campaign, period and person.
 */
@Injectable()
export class SalesOpportunitiesService {
  private readonly logger = new Logger(SalesOpportunitiesService.name)
  private readonly lastTracked = new Map<number, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly finder: CampaignFinderService,
  ) {}

  // ─── Reading ───────────────────────────────────────────

  /** The campaign's opportunities by target key, for the client list. */
  async forCampaign(campaignId: number): Promise<Map<string, OpportunityRow>> {
    const rows = await this.prisma.salesOpportunity.findMany({
      where: { campaignId, deletedAt: null },
      select: OPPORTUNITY_SELECT,
    })
    return new Map(rows.map(r => [r.targetKey, r]))
  }

  /** What each client told the bot when asking for the cancellation, by client id (the latest). */
  async customerReasons(producerId: number, clientIds: number[]): Promise<Map<number, string>> {
    const ids = [...new Set(clientIds)]
    if (!ids.length) return new Map()
    const rows = await this.prisma.notification.findMany({
      where: { producerId, type: 'baja_poliza', clientId: { in: ids }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { clientId: true, body: true },
    })
    const reasons = new Map<number, string>()
    for (const row of rows) {
      if (row.clientId == null || reasons.has(row.clientId)) continue
      const match = row.body ? CUSTOMER_REASON_RE.exec(row.body) : null
      if (match) reasons.set(row.clientId, match[1].trim())
    }
    return reasons
  }

  // ─── Opening and assigning ─────────────────────────────

  /**
   * The campaign wrote to these clients (or the office marked them contacted):
   * their opportunities open, assigned to who did it unless somebody already
   * follows them. A closed opportunity contacted again stays as it was.
   */
  async contacted(
    campaignId: number,
    producerId: number,
    definition: CampaignDefinition,
    targets: CampaignTarget[],
    actorId: number,
    now = new Date(),
  ): Promise<void> {
    for (const target of targets) {
      const key = targetKeyOf(definition, target.id)
      const existing = await this.prisma.salesOpportunity.findUnique({
        where: { campaignId_targetKey: { campaignId, targetKey: key } },
        select: { id: true, status: true, assignedToId: true, deletedAt: true },
      })
      if (!existing) {
        await this.prisma.salesOpportunity.create({
          data: {
            ...this.targetData(campaignId, producerId, definition, target, key),
            status: CONTACTED,
            contactedAt: now,
            assignedToId: actorId,
            assignedAt: now,
            updatedById: actorId,
          },
        })
        continue
      }
      await this.prisma.salesOpportunity.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          ...(existing.status === NEW ? { status: CONTACTED, contactedAt: now } : {}),
          ...(existing.assignedToId == null ? { assignedToId: actorId, assignedAt: now } : {}),
          updatedById: actorId,
        },
      })
    }
  }

  /** "Asignar a…": these clients' opportunities (opened if needed) go to one person, or to nobody. */
  async assign(
    user: ScopeUser,
    campaignId: number,
    definition: CampaignDefinition,
    targets: CampaignTarget[],
    assignedToId: number | null,
    now = new Date(),
  ): Promise<{ assigned: number }> {
    if (assignedToId != null) await this.assertAssignable(user.producerId, assignedToId)
    for (const target of targets) {
      const key = targetKeyOf(definition, target.id)
      await this.prisma.salesOpportunity.upsert({
        where: { campaignId_targetKey: { campaignId, targetKey: key } },
        create: {
          ...this.targetData(campaignId, user.producerId, definition, target, key),
          assignedToId,
          assignedAt: assignedToId == null ? null : now,
          updatedById: user.id,
        },
        update: { deletedAt: null, assignedToId, assignedAt: assignedToId == null ? null : now, updatedById: user.id },
      })
    }
    return { assigned: targets.length }
  }

  /** What the office says about one client's opportunity: closed, reopened, a note, who follows it. */
  async update(
    user: ScopeUser,
    campaignId: number,
    definition: CampaignDefinition,
    target: CampaignTarget,
    dto: UpdateOpportunityDto,
    now = new Date(),
  ): Promise<OpportunityView> {
    if (dto.assignedToId != null) await this.assertAssignable(user.producerId, dto.assignedToId)
    const key = targetKeyOf(definition, target.id)
    const current = await this.prisma.salesOpportunity.upsert({
      where: { campaignId_targetKey: { campaignId, targetKey: key } },
      create: this.targetData(campaignId, user.producerId, definition, target, key),
      update: { deletedAt: null },
      select: { ...OPPORTUNITY_SELECT, lostReason: true },
    })

    const data: Prisma.SalesOpportunityUncheckedUpdateInput = { updatedById: user.id }
    if (dto.note !== undefined) data.note = dto.note?.trim() || null
    if (dto.assignedToId !== undefined) {
      data.assignedToId = dto.assignedToId
      data.assignedAt = dto.assignedToId == null ? null : now
      // Whoever closes or follows it by hand has it, unless they take it off.
    } else if (current.assignedTo == null && dto.status) {
      data.assignedToId = user.id
      data.assignedAt = now
    }
    if (dto.lostReason !== undefined) data.lostReason = dto.lostReason
    if (dto.wonPremium !== undefined) data.wonPremium = dto.wonPremium
    switch (dto.status) {
      case WON:
        data.status = WON
        data.wonAt = current.wonAt ?? now
        data.lostAt = null
        data.lostReason = null
        if (!current.contactedAt) data.contactedAt = now
        break
      case LOST: {
        const reason = dto.lostReason ?? current.lostReason
        if (!reason) throw new BadRequestException('Decí por qué se perdió la oportunidad.')
        data.status = LOST
        data.lostAt = now
        data.lostReason = reason
        data.wonAt = null
        data.wonPremium = null
        if (!current.contactedAt) data.contactedAt = now
        break
      }
      case CONTACTED:
        // Reopened: back to where the facts leave it.
        data.status = current.quotedAt ? QUOTED : current.repliedAt ? REPLIED : current.contactedAt ? CONTACTED : NEW
        data.wonAt = null
        data.wonPremium = null
        data.lostAt = null
        data.lostReason = null
        break
    }
    const row = await this.prisma.salesOpportunity.update({
      where: { id: current.id },
      data,
      select: OPPORTUNITY_SELECT,
    })
    return opportunityView(row)
  }

  private targetData(
    campaignId: number,
    producerId: number,
    definition: CampaignDefinition,
    target: CampaignTarget,
    targetKey: string,
  ): Prisma.SalesOpportunityUncheckedCreateInput {
    return {
      campaignId,
      producerId,
      targetKey,
      producerCodeId: target.producerCodeId,
      clientId: target.clientId,
      ...(definition.kind === 'quote_followup' ? { quoteId: target.id } : { policyId: target.id }),
      // Mejora de coberturas: what the vehicle had, to tell a better coverage later.
      ...(definition.kind === 'coverage_upgrade'
        ? { coverageAtContact: target.coverages[0]?.slice(0, 20) ?? null }
        : {}),
    }
  }

  /** Only someone of the same office follows an opportunity (the platform's owner never does). */
  private async assertAssignable(producerId: number, userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, producerId, deletedAt: null, role: { not: Role.OWNER } },
      select: { id: true },
    })
    if (!user) throw new BadRequestException('Esa persona no es de esta oficina.')
  }

  // ─── Tracking what came of them ────────────────────────

  /**
   * Looks, for every open opportunity, at what happened since the contact: a
   * reply of the customer in the chat the message went to, a quote asked
   * there, and a new policy of the client in the cartera that answers the
   * campaign (the renewal, a better coverage, a product they lacked, a policy
   * for the cancelled bien). A reply asking not to be written to again puts
   * the person on the do-not-write list and closes the opportunity. Every 10
   * minutes, and before the results and the sends.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async trackAll(): Promise<void> {
    try {
      await this.track()
    } catch (error) {
      this.logger.error(`Opportunity tracking failed: ${(error as Error).message}`)
    }
  }

  async track(producerId?: number, now = new Date()): Promise<number> {
    const open: OpenRow[] = await this.prisma.salesOpportunity.findMany({
      where: { status: { in: OPEN }, deletedAt: null, ...(producerId != null ? { producerId } : {}) },
      orderBy: { updatedAt: 'asc' },
      take: TRACK_BATCH,
      select: {
        id: true,
        status: true,
        campaignId: true,
        producerId: true,
        clientId: true,
        policyId: true,
        quoteId: true,
        contactedAt: true,
        repliedAt: true,
        quotedAt: true,
        createdAt: true,
        coverageAtContact: true,
        campaign: { select: { kind: true, settings: true } },
        policy: {
          select: {
            riskType: true,
            validTo: true,
            updatedAt: true,
            vehicle: { select: { licensePlate: true, coverage: true } },
          },
        },
        quote: { select: { conversationId: true } },
      },
    })
    let moved = 0
    for (const row of open) {
      if (await this.trackOne(row)) moved++
    }
    if (producerId != null) this.lastTracked.set(producerId, now.getTime())
    if (moved) this.logger.log(`${moved} sales opportunities moved forward`)
    return moved
  }

  private async trackOne(row: OpenRow): Promise<boolean> {
    const definition = campaignOfDbKind(row.campaign.kind)
    const settings = settingsOf(definition, row.campaign.settings)
    const since = row.contactedAt ?? row.createdAt
    const message = await this.prisma.salesCampaignMessage.findFirst({
      where: {
        campaignId: row.campaignId,
        status: 'SENT',
        deletedAt: null,
        ...(row.policyId != null ? { policyId: row.policyId } : { quoteId: row.quoteId }),
      },
      orderBy: { sentAt: 'desc' },
      select: { conversationId: true },
    })
    const conversationId = message?.conversationId ?? row.quote?.conversationId ?? null
    let clientId = row.clientId
    if (clientId == null && conversationId != null) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { clientId: true },
      })
      clientId = conversation?.clientId ?? null
    }

    const data: Prisma.SalesOpportunityUncheckedUpdateInput = {}
    let status = row.status
    const higher = (next: SalesOpportunityStatus) => {
      if (RANK[next] > RANK[status]) status = next
    }
    if (conversationId != null) {
      const optOut = await this.optOutRequest(row.producerId, conversationId, since)
      if (optOut) {
        await this.prisma.salesOpportunity.update({
          where: { id: row.id },
          data: {
            status: LOST,
            lostAt: optOut.at,
            lostReason: SalesOpportunityLostReason.OTHER,
            note: `Pidió no recibir más mensajes: «${optOut.text.slice(0, 200)}»`,
            repliedAt: row.repliedAt ?? optOut.at,
          },
        })
        return true
      }
    }
    if (conversationId != null && !row.repliedAt) {
      const reply = await this.prisma.message.findFirst({
        where: { conversationId, role: 'user', deletedAt: null, createdAt: { gt: since } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      })
      if (reply) {
        data.repliedAt = reply.createdAt
        higher(REPLIED)
      }
    }
    if (conversationId != null && !row.quotedAt) {
      const quote = await this.prisma.quote.findFirst({
        where: {
          conversationId,
          deletedAt: null,
          createdAt: { gt: since },
          ...(row.quoteId != null ? { id: { not: row.quoteId } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      })
      if (quote) {
        data.quotedAt = quote.createdAt
        data.wonQuoteId = quote.id
        higher(QUOTED)
      }
    }
    if (clientId != null) {
      const won = await this.wonPolicy(definition, settings, row, clientId, since)
      if (won) {
        data.wonAt = won.at
        data.wonPolicyId = won.policyId
        data.wonPremium = won.premium
        if (row.clientId == null) data.clientId = clientId
        higher(WON)
      }
    }
    if (status === row.status && Object.keys(data).length === 0) return false
    await this.prisma.salesOpportunity.update({ where: { id: row.id }, data: { ...data, status } })
    return status !== row.status
  }

  /**
   * The customer's "no me escriban más" after the contact, if any: their
   * WhatsApp goes on the organization's do-not-write list (no campaign offers
   * them again) unless the office already took them off it after that message.
   */
  private async optOutRequest(
    producerId: number,
    conversationId: number,
    since: Date,
  ): Promise<{ at: Date; text: string } | null> {
    const replies = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: 'user',
        deletedAt: null,
        createdAt: { gt: since, lte: new Date(since.getTime() + OPT_OUT_WINDOW_DAYS * DAY_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: OPT_OUT_MESSAGES,
      select: { content: true, createdAt: true },
    })
    const request = replies.find(r => isOptOutRequest(r.content))
    if (!request) return null
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waId: true },
    })
    if (!conversation?.waId) return null
    const where = { producerId_waId: { producerId, waId: conversation.waId } }
    const existing = await this.prisma.salesCampaignOptOut.findUnique({ where, select: { deletedAt: true } })
    // "Volver a escribirle" after this message: the office read it and decided otherwise.
    if (existing?.deletedAt && existing.deletedAt >= request.createdAt) return null
    await this.prisma.salesCampaignOptOut.upsert({
      where,
      create: { producerId, waId: conversation.waId },
      update: { deletedAt: null, createdById: null },
    })
    this.logger.log(`Conversation ${conversationId} asked not to get campaign messages`)
    return { at: request.createdAt, text: request.content.replace(/\s+/g, ' ').trim() }
  }

  /** The client's policy that answers the campaign, among those the cartera brought after the contact. */
  private async wonPolicy(
    definition: CampaignDefinition,
    settings: CampaignSettings,
    row: OpenRow,
    clientId: number,
    since: Date,
  ): Promise<{ policyId: number; at: Date; premium: Prisma.Decimal | null } | null> {
    const target = row.policy
    const targetPlate = plateOf(target?.vehicle?.licensePlate)
    // Mejora de coberturas: a coverage that protects more than the one the vehicle
    // had when contacted (C2 → C2 Full counts, though the campaign lists both). An
    // opportunity older than that record: any coverage outside the campaign's list.
    const isMoto = target?.riskType === 'moto'
    const listed = codesSetting(settings, 'basicCoverages').map(c => c.toUpperCase())
    const better = (coverage: string | null | undefined): boolean => {
      if (!coverage) return false
      if (!row.coverageAtContact) return !listed.includes(coverage.trim().toUpperCase())
      return coverageRank(coverage, isMoto) > coverageRank(row.coverageAtContact, isMoto)
    }
    // The same policy, now with a better coverage, counts too.
    if (definition.kind === 'coverage_upgrade' && row.policyId != null && target?.vehicle?.coverage) {
      if (better(target.vehicle.coverage) && target.updatedAt > since) {
        const policy = await this.prisma.policy.findUnique({
          where: { id: row.policyId },
          select: { premium: true, updatedAt: true },
        })
        if (policy) return { policyId: row.policyId, at: policy.updatedAt, premium: policy.premium }
      }
    }
    const policies = await this.prisma.policy.findMany({
      where: {
        producerId: row.producerId,
        clientId,
        deletedAt: null,
        createdAt: { gt: since },
        ...(row.policyId != null ? { id: { not: row.policyId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        riskType: true,
        validFrom: true,
        premium: true,
        createdAt: true,
        vehicle: { select: { licensePlate: true, coverage: true } },
      },
    })
    // Venta cruzada: a product the campaign offers that the client did not have when contacted.
    const lacked = new Set<string>()
    if (definition.kind === 'cross_sell' && policies.length) {
      const had = await this.prisma.policy.findMany({
        where: {
          producerId: row.producerId,
          clientId,
          deletedAt: null,
          createdAt: { lte: since },
          validTo: { gte: since },
          ...notCancelledPolizaWhere(),
        },
        select: { riskType: true },
      })
      const hadRisks = new Set<string>(had.map(p => p.riskType))
      for (const product of codesSetting(settings, 'offer') as CrossSellProduct[]) {
        if (!PRODUCT_RISKS[product].some(risk => hadRisks.has(risk))) {
          PRODUCT_RISKS[product].forEach(risk => lacked.add(risk))
        }
      }
    }
    const sameBien = (p: (typeof policies)[number]) =>
      targetPlate ? plateOf(p.vehicle?.licensePlate) === targetPlate : target ? p.riskType === target.riskType : true
    const won = policies.find(p => {
      switch (definition.kind) {
        case 'winback':
          return sameBien(p)
        case 'renewal': {
          if (!sameBien(p)) return false
          if (!target?.validTo || !p.validFrom) return true
          return Math.abs(p.validFrom.getTime() - target.validTo.getTime()) <= RENEWAL_WINDOW_DAYS * DAY_MS
        }
        case 'coverage_upgrade':
          return sameBien(p) && better(p.vehicle?.coverage)
        case 'cross_sell':
          return lacked.has(p.riskType)
        case 'quote_followup':
          return true
      }
    })
    return won ? { policyId: won.id, at: won.createdAt, premium: won.premium } : null
  }

  // ─── Results ───────────────────────────────────────────

  /**
   * How the campaigns did in a period (by default the last 90 days), in the
   * user's codes and numbers: what went out, how many answered, got a quote, bought or
   * were lost, and the premium of what was sold; by campaign and by person.
   * An opportunity belongs to the period it was contacted in.
   */
  async results(user: ScopeUser, scope: CampaignScope, query: CampaignResultsDto, now = new Date()) {
    if (now.getTime() - (this.lastTracked.get(user.producerId) ?? 0) > TRACK_STALE_MS) {
      await this.track(user.producerId, now).catch(error =>
        this.logger.warn(`Opportunity tracking before the results failed: ${(error as Error).message}`),
      )
    }
    const { from, to } = this.period(query, now)
    const campaigns = await this.prisma.salesCampaign.findMany({
      where: {
        producerId: user.producerId,
        deletedAt: null,
        ...(query.kind ? { kind: CAMPAIGNS[query.kind].dbKind } : {}),
      },
      select: { id: true, kind: true },
    })
    const campaignIds = campaigns.map(c => c.id)
    // A policy's opportunity belongs to its code; a quote's, to the number the person wrote to.
    const inScope = {
      OR: [
        { quoteId: null, producerCodeId: { in: scope.codeIds } },
        { quote: await this.finder.quoteOrigin(user.producerId, scope) },
      ],
    }
    const [opportunities, messages] = campaignIds.length
      ? await Promise.all([
          this.prisma.salesOpportunity.findMany({
            where: {
              campaignId: { in: campaignIds },
              deletedAt: null,
              status: { not: NEW },
              contactedAt: { gte: from, lt: to },
              ...inScope,
              ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
            },
            select: {
              campaignId: true,
              status: true,
              repliedAt: true,
              quotedAt: true,
              wonPremium: true,
              assignedTo: { select: PERSON_SELECT },
            },
          }),
          this.prisma.salesCampaignMessage.findMany({
            where: {
              campaignId: { in: campaignIds },
              deletedAt: null,
              status: { in: ['SENT', 'MARKED'] },
              sentAt: { gte: from, lt: to },
              ...inScope,
              ...(query.assignedToId ? { sentById: query.assignedToId } : {}),
            },
            select: { campaignId: true, status: true },
          }),
        ])
      : [[], []]

    const byCampaign = new Map(
      campaigns.map(c => [c.id, { ...emptyCounts(), sent: 0, marked: 0, definition: campaignOfDbKind(c.kind) }]),
    )
    const byAssignee = new Map<number | null, Counts & { user: { id: number; name: string | null } | null }>()
    for (const message of messages) {
      const bucket = byCampaign.get(message.campaignId)
      if (!bucket) continue
      if (message.status === 'SENT') bucket.sent++
      else bucket.marked++
    }
    for (const opportunity of opportunities) {
      const bucket = byCampaign.get(opportunity.campaignId)
      if (bucket) count(bucket, opportunity)
      const key = opportunity.assignedTo?.id ?? null
      const person = byAssignee.get(key) ?? { ...emptyCounts(), user: opportunity.assignedTo ?? null }
      count(person, opportunity)
      byAssignee.set(key, person)
    }

    const totals = { ...emptyCounts(), sent: 0, marked: 0 }
    const result = Object.values(CAMPAIGNS)
      .filter(definition => !query.kind || definition.kind === query.kind)
      .map(definition => {
        const bucket = [...byCampaign.values()].find(b => b.definition.kind === definition.kind)
        const counts = bucket ? { ...bucket } : { ...emptyCounts(), sent: 0, marked: 0 }
        totals.sent += counts.sent
        totals.marked += counts.marked
        totals.contacted += counts.contacted
        totals.replied += counts.replied
        totals.quoted += counts.quoted
        totals.won += counts.won
        totals.lost += counts.lost
        totals.open += counts.open
        totals.premium += counts.premium
        return {
          kind: definition.kind,
          label: definition.label,
          sent: counts.sent,
          marked: counts.marked,
          contacted: counts.contacted,
          replied: counts.replied,
          quoted: counts.quoted,
          won: counts.won,
          lost: counts.lost,
          open: counts.open,
          premium: round(counts.premium),
        }
      })
    return {
      from: from.toISOString(),
      to: new Date(to.getTime() - 1).toISOString(),
      campaigns: result,
      totals: { ...totals, premium: round(totals.premium) },
      byAssignee: [...byAssignee.values()]
        .map(p => ({ ...p, premium: round(p.premium) }))
        .sort((a, b) => b.won - a.won || b.contacted - a.contacted),
    }
  }

  /** The period as [from, to): a day given as "YYYY-MM-DD" covers the whole day. */
  private period(query: CampaignResultsDto, now: Date): { from: Date; to: Date } {
    const dayOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    const to = query.to
      ? dayOnly(query.to)
        ? new Date(Date.parse(`${query.to}T00:00:00-03:00`) + DAY_MS)
        : new Date(query.to)
      : new Date(now.getTime() + 1)
    const from = query.from
      ? dayOnly(query.from)
        ? new Date(`${query.from}T00:00:00-03:00`)
        : new Date(query.from)
      : new Date(to.getTime() - DEFAULT_RESULTS_DAYS * DAY_MS)
    if (!(from < to)) throw new BadRequestException('El período no tiene días.')
    return { from, to }
  }
}

const round = (value: number) => Math.round(value * 100) / 100
