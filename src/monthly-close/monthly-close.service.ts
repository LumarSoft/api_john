import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { readSettlementTerms, settle, Settlement, SettlementTerms } from '../settlement/settlement-terms'
import {
  acceptedBlocks,
  BilledPlan,
  consumedMessages,
  currentPeriod,
  nextPeriod,
  pausedIn,
  UsageService,
} from '../usage/usage.service'

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const round2 = (n: number): number => Math.round(n * 100) / 100

/** The month before `period` ("2026-01" → "2025-12"). */
export function previousPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/** Today in Argentina, "YYYY-MM-DD". */
function argentinaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ }).format(date)
}

/** A close made after the 1st of the next month recomputes the month with that day's plans: it is a backfill. */
export function isBackfill(period: string, closedAt: Date): boolean {
  return argentinaDay(closedAt) > `${nextPeriod(period)}-01`
}

/** A number's month as the owner's screens read it: frozen when the month is closed, computed now otherwise. */
export interface MonthNumber {
  phoneNumberId: number
  producerId: number
  producerCodeId: number | null
  number: string
  isActive: boolean
  responsibleCode: { code: string; holderName: string | null } | null
  /** The plan the month is billed on. */
  plan: BilledPlan
  /** The plan the number is on before the month's messages; not kept by a close (null). */
  assignedPlan: BilledPlan | null
  upgraded: boolean
  prorated: boolean
  /** Its assistant is paused for its plan (running month only). */
  paused: boolean
  /** Billed or sending that month: an active number of the month. */
  inService: boolean
  /** Its first month of service: a new number of the month. */
  firstMonth: boolean
  /** Messages sent, one each. */
  messages: number
  /** Of those, templates. */
  templateMessages: number
  /** Plan messages consumed (a template counts twice from COMMERCIAL_TEMPLATE_WEIGHT_FROM on). */
  consumedMessages: number
  metaBillableMessages: number
  metaCostUsd: number
  openaiCostUsd: number
  /** The owner's "Facturado": the plan, prorated in the first month of service. */
  billedUsd: number
  /** Null when the settlement terms were not configured (live: today; closed: on the day of the close). */
  settlement: Settlement | null
}

export interface MonthSnapshot {
  period: string
  /** Read from a close; false = computed now with each number's current plan. */
  closed: boolean
  closedAt: Date | null
  /** The close was made after the 1st of the next month, with the plans of that day. */
  backfilled: boolean
  /** Every organization the month lists, in the order they were created. */
  organizations: { id: number; name: string; isActive: boolean }[]
  numbers: MonthNumber[]
}

export interface CloseResult {
  period: string
  alreadyClosed: boolean
  closedNumbers: number
  backfilled: boolean
  closedAt: Date | null
}

const CLOSE_SELECT = {
  phoneNumberId: true,
  producerId: true,
  producerCodeId: true,
  number: true,
  isActive: true,
  inService: true,
  firstMonth: true,
  planId: true,
  planName: true,
  planMessages: true,
  planPriceUsd: true,
  planExtraBlocks: true,
  trial: true,
  upgraded: true,
  prorated: true,
  messages: true,
  templateMessages: true,
  consumedMessages: true,
  metaBillableMessages: true,
  metaCostUsd: true,
  openaiCostUsd: true,
  billedUsd: true,
  costPerMessageUsd: true,
  serviceCostUsd: true,
  remainderUsd: true,
  partnerShare: true,
  partnerShareUsd: true,
  ownerShareUsd: true,
  backfilled: true,
  closedAt: true,
  producerCode: { select: { code: true, holderName: true } },
} as const

/**
 * Freezes each number's month once it ends, so the owner's screens stop recomputing past months with today's plans.
 *
 * On the 1st of every month at 00:00 (Argentina) the previous month is closed (MONTHLY_CLOSE_ENABLED, on by default,
 * guarded against overlap); a boot finds the previous month still open and closes it too. The owner can close any past
 * month by hand, which is how months before this existed get backfilled. A closed month is never written again
 * unless the owner asks for it with `force`.
 */
@Injectable()
export class MonthlyCloseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MonthlyCloseService.name)
  private readonly enabled: boolean
  /** The settlement terms of today (null = not configured): a live month uses them, a closed month keeps its own. */
  readonly terms: SettlementTerms | null
  private closing = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('MONTHLY_CLOSE_ENABLED') !== 'false'
    this.terms = readSettlementTerms(config)
    if (!this.terms)
      this.logger.warn('Partner settlement terms not configured: months close without their settlement figures')
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return
    void this.closePreviousMonth()
  }

  /** The previous month, as soon as it ends. */
  @Cron('0 0 1 * *', { timeZone: ARGENTINA_TZ })
  async scheduledClose(): Promise<void> {
    if (!this.enabled) return
    await this.closePreviousMonth()
  }

  async closePreviousMonth(now: Date = new Date()): Promise<CloseResult | null> {
    try {
      const result = await this.close(previousPeriod(currentPeriod(now)), { now })
      if (!result.alreadyClosed)
        this.logger.log(
          `Closed ${result.period}: ${result.closedNumbers} numbers${result.backfilled ? ' (backfilled)' : ''}`,
        )
      return result
    } catch (error) {
      this.logger.error(`Monthly close failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** The owner closes a past month by hand; a month already closed needs `force` to be recomputed. */
  async closeFromOwner(period: string, force = false): Promise<CloseResult> {
    const result = await this.close(period, { force })
    if (result.alreadyClosed)
      throw new ConflictException('Ese mes ya está cerrado. Para recalcularlo con los planes de hoy, usá force.')
    return result
  }

  /**
   * Writes the month of every number that was in service, sent or cost something in it: one row per number, all in
   * one transaction. Idempotent: a month that has rows is left alone unless `force`, which rewrites them (and retires
   * the rows of numbers that no longer qualify).
   */
  async close(period: string, options: { force?: boolean; now?: Date } = {}): Promise<CloseResult> {
    const now = options.now ?? new Date()
    if (!PERIOD_RE.test(period) || period >= currentPeriod(now))
      throw new BadRequestException('Solo se cierra un mes que ya terminó.')
    if (this.closing) throw new ConflictException('Ya hay un cierre de mes en curso.')
    this.closing = true
    try {
      const existing = await this.prisma.monthlyClose.findMany({
        where: { period },
        select: { id: true, phoneNumberId: true, deletedAt: true },
      })
      if (existing.some(row => row.deletedAt === null) && !options.force)
        return { period, alreadyClosed: true, closedNumbers: 0, backfilled: false, closedAt: null }

      const month = await this.liveMonth(period)
      const kept = month.numbers.filter(n => n.inService || n.messages > 0 || n.openaiCostUsd > 0)
      const backfilled = isBackfill(period, now)
      const byPhone = new Map(existing.map(row => [row.phoneNumberId, row.id]))
      const keptPhones = new Set(kept.map(n => n.phoneNumberId))
      await this.prisma.$transaction([
        ...kept.map(n => {
          const data = { ...this.closeData(n), backfilled, closedAt: now, deletedAt: null }
          const id = byPhone.get(n.phoneNumberId)
          return id
            ? this.prisma.monthlyClose.update({ where: { id }, data })
            : this.prisma.monthlyClose.create({ data: { ...data, period } })
        }),
        ...existing
          .filter(row => row.deletedAt === null && !keptPhones.has(row.phoneNumberId))
          .map(row => this.prisma.monthlyClose.update({ where: { id: row.id }, data: { deletedAt: now } })),
      ])
      return { period, alreadyClosed: false, closedNumbers: kept.length, backfilled, closedAt: now }
    } finally {
      this.closing = false
    }
  }

  /** A month as the owner's screens read it: from its close, or computed now (the running month, an unclosed one). */
  async monthSnapshot(period: string): Promise<MonthSnapshot> {
    const [snapshot] = await this.monthSnapshots([period])
    return snapshot
  }

  /** Several months at once: one read for every close, and a live computation only for the months not closed. */
  async monthSnapshots(periods: string[]): Promise<MonthSnapshot[]> {
    const closes = await this.prisma.monthlyClose.findMany({
      where: { period: { in: periods }, deletedAt: null },
      orderBy: [{ producerId: 'asc' }, { phoneNumberId: 'asc' }],
      select: { ...CLOSE_SELECT, period: true },
    })
    const closedPeriods = new Set(closes.map(c => c.period))
    const producerIds = [...new Set(closes.map(c => c.producerId))]
    const organizations = closes.length > 0 ? await this.organizationsWith(producerIds) : []
    return Promise.all(
      periods.map(period => {
        if (!closedPeriods.has(period)) return this.liveMonth(period)
        const rows = closes.filter(c => c.period === period)
        const listed = new Set(rows.map(r => r.producerId))
        return {
          period,
          closed: true,
          closedAt: rows[0].closedAt,
          backfilled: rows.some(r => r.backfilled),
          organizations: organizations
            .filter(o => o.deletedAt === null || listed.has(o.id))
            .map(({ id, name, isActive }) => ({ id, name, isActive })),
          numbers: rows.map(r => this.fromClose(r)),
        }
      }),
    )
  }

  /** Every number of every organization, with the month computed now on its current plan (the live month). */
  private async liveMonth(period: string): Promise<MonthSnapshot> {
    const [organizations, catalog] = await Promise.all([
      this.prisma.producer.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          phoneNumbers: {
            where: { deletedAt: null },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              number: true,
              isActive: true,
              planId: true,
              planUpgradedAt: true,
              planPausedAt: true,
              extraBlocks: true,
              extraBlocksPeriod: true,
              responsibleProducerCodeId: true,
              responsibleProducerCode: { select: { code: true, holderName: true } },
              usageMonthly: {
                where: { period },
                select: {
                  metaMessages: true,
                  metaTemplateMessages: true,
                  templateExtraMessages: true,
                  metaBillableMessages: true,
                  metaCostUsd: true,
                  openaiCostUsd: true,
                },
              },
            },
          },
        },
      }),
      this.usage.catalog(),
    ])
    const starts = await this.usage.serviceStarts(organizations.flatMap(o => o.phoneNumbers.map(n => n.id)))
    const running = period === currentPeriod()

    const numbers = organizations.flatMap(org =>
      org.phoneNumbers.map((n): MonthNumber => {
        const usage = n.usageMonthly[0]
        const serviceStartedAt = starts.get(n.id) ?? null
        const bill = this.usage.billFor(
          { isActive: n.isActive, serviceStartedAt, planId: n.planId, extraBlocks: acceptedBlocks(n, period) },
          usage,
          catalog,
          period,
        )
        const startPeriod = serviceStartedAt ? currentPeriod(serviceStartedAt) : null
        const messages = usage?.metaMessages ?? 0
        return {
          phoneNumberId: n.id,
          producerId: org.id,
          producerCodeId: n.responsibleProducerCodeId,
          number: n.number,
          isActive: n.isActive,
          responsibleCode: n.responsibleProducerCode,
          plan: bill.plan,
          assignedPlan: bill.assignedPlan,
          upgraded: bill.upgraded || (n.planUpgradedAt != null && currentPeriod(n.planUpgradedAt) === period),
          prorated: bill.prorated,
          paused: running && pausedIn(n.planPausedAt, period),
          inService: startPeriod !== null && startPeriod <= period && (n.isActive || messages > 0),
          firstMonth: startPeriod === period,
          messages,
          templateMessages: usage?.metaTemplateMessages ?? 0,
          consumedMessages: consumedMessages(usage),
          metaBillableMessages: usage?.metaBillableMessages ?? 0,
          metaCostUsd: round2(Number(usage?.metaCostUsd ?? 0)),
          openaiCostUsd: round2(Number(usage?.openaiCostUsd ?? 0)),
          billedUsd: bill.billedUsd,
          settlement: this.terms ? settle(bill.billedUsd, consumedMessages(usage), this.terms) : null,
        }
      }),
    )
    return {
      period,
      closed: false,
      closedAt: null,
      backfilled: false,
      organizations: organizations.map(({ id, name, isActive }) => ({ id, name, isActive })),
      numbers,
    }
  }

  /** The organizations a closed month lists: today's, plus any one since removed that had numbers in it. */
  private organizationsWith(producerIds: number[]) {
    return this.prisma.producer.findMany({
      where: { OR: [{ deletedAt: null }, { id: { in: producerIds } }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, isActive: true, deletedAt: true },
    })
  }

  private closeData(n: MonthNumber) {
    return {
      phoneNumberId: n.phoneNumberId,
      producerId: n.producerId,
      producerCodeId: n.producerCodeId,
      number: n.number.slice(0, 40),
      isActive: n.isActive,
      inService: n.inService,
      firstMonth: n.firstMonth,
      planId: n.plan.id,
      planName: n.plan.name.slice(0, 80),
      planMessages: n.plan.includedMessages,
      planPriceUsd: n.plan.priceUsd,
      planExtraBlocks: n.plan.extraBlocks,
      trial: n.plan.trial,
      upgraded: n.upgraded,
      prorated: n.prorated,
      messages: n.messages,
      templateMessages: n.templateMessages,
      consumedMessages: n.consumedMessages,
      metaBillableMessages: n.metaBillableMessages,
      metaCostUsd: n.metaCostUsd,
      openaiCostUsd: n.openaiCostUsd,
      billedUsd: n.billedUsd,
      // Without settlement terms the month still closes: only the settlement stays empty.
      costPerMessageUsd: n.settlement?.costPerMessageUsd ?? null,
      serviceCostUsd: n.settlement?.serviceCostUsd ?? null,
      remainderUsd: n.settlement?.remainderUsd ?? null,
      partnerShare: n.settlement?.partnerShare ?? null,
      partnerShareUsd: n.settlement?.partnerShareUsd ?? null,
      ownerShareUsd: n.settlement?.ownerShareUsd ?? null,
    }
  }

  private fromClose(row: CloseRow): MonthNumber {
    return {
      phoneNumberId: row.phoneNumberId,
      producerId: row.producerId,
      producerCodeId: row.producerCodeId,
      number: row.number,
      isActive: row.isActive,
      responsibleCode: row.producerCode,
      plan: {
        id: row.planId,
        name: row.planName,
        includedMessages: row.planMessages,
        priceUsd: Number(row.planPriceUsd),
        trial: row.trial,
        extraBlocks: row.planExtraBlocks,
      },
      assignedPlan: null,
      upgraded: row.upgraded,
      prorated: row.prorated,
      paused: false,
      inService: row.inService,
      firstMonth: row.firstMonth,
      messages: row.messages,
      templateMessages: row.templateMessages,
      consumedMessages: row.consumedMessages,
      metaBillableMessages: row.metaBillableMessages,
      metaCostUsd: round2(Number(row.metaCostUsd)),
      openaiCostUsd: round2(Number(row.openaiCostUsd)),
      billedUsd: Number(row.billedUsd),
      settlement:
        row.costPerMessageUsd == null || row.partnerShare == null
          ? null
          : {
              costPerMessageUsd: Number(row.costPerMessageUsd),
              partnerShare: Number(row.partnerShare),
              serviceCostUsd: Number(row.serviceCostUsd),
              remainderUsd: Number(row.remainderUsd),
              partnerShareUsd: Number(row.partnerShareUsd),
              ownerShareUsd: Number(row.ownerShareUsd),
            },
    }
  }
}

/** A MonthlyClose row as CLOSE_SELECT reads it (decimals arrive as Prisma Decimals). */
interface CloseRow {
  phoneNumberId: number
  producerId: number
  producerCodeId: number | null
  number: string
  isActive: boolean
  inService: boolean
  firstMonth: boolean
  planId: number | null
  planName: string
  planMessages: number
  planPriceUsd: unknown
  planExtraBlocks: number
  trial: boolean
  upgraded: boolean
  prorated: boolean
  messages: number
  templateMessages: number
  consumedMessages: number
  metaBillableMessages: number
  metaCostUsd: unknown
  openaiCostUsd: unknown
  billedUsd: unknown
  costPerMessageUsd: unknown
  serviceCostUsd: unknown
  remainderUsd: unknown
  partnerShare: unknown
  partnerShareUsd: unknown
  ownerShareUsd: unknown
  producerCode: { code: string; holderName: string | null } | null
}
