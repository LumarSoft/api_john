import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { BlockedClaimReason, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { BUSINESS_TZ } from '../business-hours/schedule'
import { notCancelledPolizaWhere } from '../common/poliza-vigencia'
import { BalanceTally, type BalanceMetric, type BalanceValues, type CodeAttribution } from './balance-metrics'
import { closedPeriods, isClosedPeriod, periodRanges } from './balance-period'

/** A snapshot taken this long after the month ended still reads the month-end state. */
export const MONTH_END_GRACE_MS = 3 * 24 * 60 * 60_000
const DEFAULT_BACKFILL_MONTHS = 6
const MAX_BACKFILL_MONTHS = 24

const BLOCKED_CLAIM_METRIC: Record<BlockedClaimReason, BalanceMetric> = {
  NO_POLICY: 'claimsBlockedNoPolicy',
  REJECTED_PAYMENT: 'claimsBlockedRejectedPayment',
  OVERDUE_INSTALLMENTS: 'claimsBlockedOverdue',
}

export interface OrganizationSnapshot {
  producerId: number
  /** Rows written (one per producer code). */
  rows: number
  /** Why nothing was written: the month already closed, or the organization did not exist yet. */
  skipped?: 'already_closed' | 'not_created_yet' | 'no_codes'
}

export interface PeriodSnapshot {
  period: string
  /** False = rebuilt after the fact: month-end metrics stored as null. */
  monthEnd: boolean
  organizations: OrganizationSnapshot[]
}

/**
 * Writes the monthly balance: on the 1st, the month that just closed; on boot
 * and on the 1st, any of the last MONTHLY_BALANCE_BACKFILL_MONTHS months that
 * has no rows yet, rebuilt from dated records. A month with rows is never
 * rewritten unless the owner forces it (POST /owner/balance/snapshots).
 * Metric definitions: balance-metrics.ts.
 */
@Injectable()
export class MonthlyBalanceSnapshotService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MonthlyBalanceSnapshotService.name)
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('MONTHLY_BALANCE_ENABLED') !== 'false'
  }

  private get backfillMonths(): number {
    const configured = Number(this.config.get<string>('MONTHLY_BALANCE_BACKFILL_MONTHS'))
    if (!Number.isInteger(configured) || configured < 0) return DEFAULT_BACKFILL_MONTHS
    return Math.min(configured, MAX_BACKFILL_MONTHS)
  }

  /** Fills the missing months once the API is up (a no-op when they are there). */
  onApplicationBootstrap(): void {
    if (!this.enabled) return
    void this.runGuarded(() => this.backfill(this.backfillMonths)).catch((error: Error) =>
      this.logger.error(`Monthly balance backfill failed: ${error.message}`),
    )
  }

  // 00:30 of the 1st in Argentina: after the 00:15 pass that marks cuotas overdue.
  @Cron('30 0 1 * *', { timeZone: BUSINESS_TZ })
  async closeMonth(): Promise<void> {
    if (!this.enabled) return
    try {
      await this.runGuarded(() => this.backfill(Math.max(1, this.backfillMonths)))
    } catch (error) {
      this.logger.error(`Monthly balance snapshot failed: ${(error as Error).message}`)
    }
  }

  /** The owner's manual run: one closed month, optionally rewritten and for one organization. */
  async runForOwner(input: { period: string; force?: boolean; producerId?: number }): Promise<PeriodSnapshot> {
    if (!isClosedPeriod(input.period)) throw new BadRequestException('El mes todavía no terminó')
    const result = await this.runGuarded(() => this.snapshotPeriod(input.period, input))
    if (!result) throw new ConflictException('Ya se está generando el balance; probá en unos minutos')
    return result
  }

  /** Runs one job at a time; null when another is in flight. */
  private async runGuarded<T>(job: () => Promise<T>): Promise<T | null> {
    if (this.running) {
      this.logger.warn('Monthly balance already running — skipping this run')
      return null
    }
    this.running = true
    try {
      return await job()
    } finally {
      this.running = false
    }
  }

  /** Snapshots each of the last `months` closed months that has no rows yet, oldest first. */
  async backfill(months: number, now: Date = new Date()): Promise<PeriodSnapshot[]> {
    const results: PeriodSnapshot[] = []
    for (const period of closedPeriods(months, now)) {
      results.push(await this.snapshotPeriod(period, { now }))
    }
    const written = results.flatMap(r => r.organizations).reduce((sum, o) => sum + o.rows, 0)
    if (written) this.logger.log(`Monthly balance: ${written} rows written (${results.map(r => r.period).join(', ')})`)
    return results
  }

  /**
   * Writes `period` for every active organization (or `producerId`). The
   * month-end metrics are read only when this runs within MONTH_END_GRACE_MS
   * of the close; later the month is rebuilt and they stay null.
   */
  async snapshotPeriod(
    period: string,
    options: { force?: boolean; producerId?: number; now?: Date } = {},
  ): Promise<PeriodSnapshot> {
    const now = options.now ?? new Date()
    if (!isClosedPeriod(period, now)) throw new BadRequestException('El mes todavía no terminó')
    const { to } = periodRanges(period)
    const elapsed = now.getTime() - to.getTime()
    const monthEnd = elapsed >= 0 && elapsed <= MONTH_END_GRACE_MS

    const organizations = await this.prisma.producer.findMany({
      where: options.producerId ? { id: options.producerId, deletedAt: null } : { isActive: true, deletedAt: null },
      select: { id: true, createdAt: true },
      orderBy: { id: 'asc' },
    })
    const results: OrganizationSnapshot[] = []
    for (const org of organizations) {
      results.push(await this.snapshotOrganization(org, period, monthEnd, now, !!options.force))
    }
    return { period, monthEnd, organizations: results }
  }

  private async snapshotOrganization(
    org: { id: number; createdAt: Date },
    period: string,
    monthEnd: boolean,
    now: Date,
    force: boolean,
  ): Promise<OrganizationSnapshot> {
    const { to } = periodRanges(period)
    // Before the organization existed there is nothing to rebuild: "sin dato", not zeros.
    if (org.createdAt >= to) return { producerId: org.id, rows: 0, skipped: 'not_created_yet' }
    if (!force) {
      const existing = await this.prisma.monthlyBalance.count({
        where: { producerId: org.id, period, deletedAt: null },
      })
      if (existing) return { producerId: org.id, rows: 0, skipped: 'already_closed' }
    }
    const values = await this.computeOrganization(org.id, period, monthEnd)
    if (!values.size) return { producerId: org.id, rows: 0, skipped: 'no_codes' }
    const backfilled = !monthEnd
    await this.prisma.$transaction(
      [...values].map(([producerCodeId, metrics]) =>
        this.prisma.monthlyBalance.upsert({
          where: { producerId_producerCodeId_period: { producerId: org.id, producerCodeId, period } },
          create: { producerId: org.id, producerCodeId, period, backfilled, snapshotAt: now, ...metrics },
          update: { backfilled, snapshotAt: now, deletedAt: null, ...metrics },
        }),
      ),
    )
    return { producerId: org.id, rows: values.size }
  }

  /** The month's values of one organization, per producer code (see balance-metrics.ts). */
  async computeOrganization(
    producerId: number,
    period: string,
    monthEnd: boolean,
  ): Promise<Map<number, BalanceValues>> {
    const ctx = await this.attribution(producerId)
    if (!ctx) return new Map()
    const tally = new BalanceTally(ctx, monthEnd)
    const { from, to, dateFrom, dateTo } = periodRanges(period)
    const createdIn = { gte: from, lt: to }

    await this.countPolicies(tally, producerId, dateFrom, dateTo, monthEnd)
    if (monthEnd) await this.countInstallments(tally, producerId)
    await this.countClaims(tally, producerId, createdIn, monthEnd)
    await this.countHandoffs(tally, producerId, createdIn)
    await this.countSales(tally, producerId, createdIn, monthEnd)

    const conversations = await this.prisma.conversation.groupBy({
      by: ['producerCodeId', 'phoneNumberId'],
      where: { producerId, deletedAt: null, createdAt: createdIn },
      _count: { _all: true },
    })
    for (const c of conversations)
      tally.add(
        'conversationsNew',
        { producerCodeId: c.producerCodeId, metaPhoneNumberId: c.phoneNumberId },
        c._count._all,
      )

    const usage = await this.prisma.usageMonthly.findMany({
      where: { producerId, period },
      select: { producerCodeId: true, phoneNumberId: true, metaMessages: true },
    })
    for (const u of usage) tally.add('messagesSent', u, u.metaMessages)

    const sentIn = { deletedAt: null, producerId, status: 'SENT' as const, sentAt: createdIn }
    const rejectionNotices = await this.prisma.paymentRejection.groupBy({
      by: ['producerCodeId'],
      where: sentIn,
      _count: { _all: true },
    })
    for (const n of rejectionNotices) tally.add('rejectionNoticesSent', n, n._count._all)
    const expiryNotices = await this.prisma.policyExpiryNotice.groupBy({
      by: ['producerCodeId'],
      where: sentIn,
      _count: { _all: true },
    })
    for (const n of expiryNotices) tally.add('expiryNoticesSent', n, n._count._all)

    return tally.result()
  }

  /** The organization's codes and numbers, to credit each record to a code. Null without codes. */
  private async attribution(producerId: number): Promise<CodeAttribution | null> {
    const codes = await this.prisma.producerCode.findMany({
      where: { producerId, deletedAt: null },
      select: { id: true, isMaster: true },
      orderBy: { id: 'asc' },
    })
    if (!codes.length) return null
    // Numbers removed since still credit what came through them.
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId },
      select: { id: true, phoneNumberId: true, responsibleProducerCodeId: true },
    })
    return {
      codeIds: new Set(codes.map(c => c.id)),
      masterCodeId: (codes.find(c => c.isMaster) ?? codes[0]).id,
      byMetaNumber: new Map(numbers.map(n => [n.phoneNumberId, n.responsibleProducerCodeId])),
      byNumberId: new Map(numbers.map(n => [n.id, n.responsibleProducerCodeId])),
    }
  }

  private async countPolicies(
    tally: BalanceTally,
    producerId: number,
    dateFrom: Date,
    dateTo: Date,
    monthEnd: boolean,
  ): Promise<void> {
    const base = { producerId, deletedAt: null }
    const inForce = await this.prisma.policy.findMany({
      where: {
        ...base,
        validTo: { gte: dateTo },
        OR: [{ validFrom: null }, { validFrom: { lt: dateTo } }],
        ...notCancelledPolizaWhere(),
      },
      select: { producerCodeId: true, premium: true },
    })
    for (const policy of inForce) {
      tally.add('policiesInForce', policy)
      if (monthEnd) tally.add('premiumInForce', policy, Math.max(0, Number(policy.premium ?? 0)))
    }
    const started = await this.prisma.policy.groupBy({
      by: ['producerCodeId'],
      where: { ...base, validFrom: { gte: dateFrom, lt: dateTo } },
      _count: { _all: true },
    })
    for (const p of started) tally.add('policiesNew', p, p._count._all)
    const ended = await this.prisma.policy.groupBy({
      by: ['producerCodeId'],
      where: { ...base, validTo: { gte: dateFrom, lt: dateTo }, ...notCancelledPolizaWhere() },
      _count: { _all: true },
    })
    for (const p of ended) tally.add('policiesLost', p, p._count._all)
  }

  /** Month-end debt, as the dashboard computes it: credits (negative amounts) are not debt. */
  private async countInstallments(tally: BalanceTally, producerId: number): Promise<void> {
    const cuotas = await this.prisma.installment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['pending', 'overdue', 'rejected'] },
        policy: { producerId, deletedAt: null, ...notCancelledPolizaWhere() },
      },
      select: { amount: true, status: true, policy: { select: { producerCodeId: true } } },
    })
    for (const cuota of cuotas) {
      tally.add('debtAmount', cuota.policy, Math.max(0, Number(cuota.amount)))
      if (cuota.status === 'overdue') tally.add('installmentsOverdue', cuota.policy)
      if (cuota.status === 'rejected') tally.add('installmentsRejected', cuota.policy)
    }
  }

  private async countClaims(
    tally: BalanceTally,
    producerId: number,
    createdIn: Prisma.DateTimeFilter,
    monthEnd: boolean,
  ): Promise<void> {
    const filed = await this.prisma.claim.groupBy({
      by: ['producerCodeId'],
      where: { producerId, deletedAt: null, createdAt: createdIn },
      _count: { _all: true },
    })
    for (const c of filed) tally.add('claimsFiled', c, c._count._all)
    if (!monthEnd) return
    const open = await this.prisma.claim.groupBy({
      by: ['producerCodeId'],
      where: { producerId, deletedAt: null, status: { in: ['pending', 'in_progress'] } },
      _count: { _all: true },
    })
    for (const c of open) tally.add('claimsOpen', c, c._count._all)
  }

  /** Requests for a person and the claims the bot stopped (soft-deleted ones too, see balance-metrics.ts). */
  private async countHandoffs(
    tally: BalanceTally,
    producerId: number,
    createdIn: Prisma.DateTimeFilter,
  ): Promise<void> {
    const handoffs = await this.prisma.notification.groupBy({
      by: ['producerCodeId', 'phoneNumberId', 'blockedClaimReason'],
      where: { producerId, type: 'handoff', createdAt: createdIn },
      _count: { _all: true },
    })
    for (const h of handoffs) {
      const record = { producerCodeId: h.producerCodeId, metaPhoneNumberId: h.phoneNumberId }
      tally.add('handoffs', record, h._count._all)
      if (h.blockedClaimReason) tally.add(BLOCKED_CLAIM_METRIC[h.blockedClaimReason], record, h._count._all)
    }
  }

  private async countSales(
    tally: BalanceTally,
    producerId: number,
    createdIn: Prisma.DateTimeFilter,
    monthEnd: boolean,
  ): Promise<void> {
    const quotes = await this.prisma.quote.groupBy({
      by: ['producerCodeId', 'phoneNumberId'],
      where: { producerId, deletedAt: null, createdAt: createdIn },
      _count: { _all: true },
    })
    for (const q of quotes) {
      const record = { producerCodeId: q.producerCodeId, metaPhoneNumberId: q.phoneNumberId }
      tally.add(q.phoneNumberId ? 'quotesBot' : 'quotesWeb', record, q._count._all, true)
    }

    const requests = await this.prisma.quoteRequest.findMany({
      where: { deletedAt: null, createdAt: createdIn, quote: { producerId, deletedAt: null } },
      select: { status: true, quote: { select: { producerCodeId: true, phoneNumberId: true } } },
    })
    for (const r of requests) {
      const record = { producerCodeId: r.quote.producerCodeId, metaPhoneNumberId: r.quote.phoneNumberId }
      tally.add('quoteRequests', record, 1, true)
      if (monthEnd && r.status === 'CLOSED') tally.add('requestsClosed', record, 1, true)
    }

    const leads = await this.prisma.contactLead.groupBy({
      by: ['producerCodeId', 'phoneNumberId', 'status'],
      where: { producerId, deletedAt: null, createdAt: createdIn },
      _count: { _all: true },
    })
    for (const l of leads) {
      const record = { producerCodeId: l.producerCodeId, metaPhoneNumberId: l.phoneNumberId }
      tally.add('contactLeads', record, l._count._all)
      if (monthEnd && l.status === 'CLOSED') tally.add('requestsClosed', record, l._count._all)
    }
  }
}
