import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BALANCE_METRICS, MONEY_METRICS, type BalanceMetric } from './balance-metrics'
import { closedPeriods } from './balance-period'

/** Totals the panel shows besides the stored metrics. */
const DERIVED_METRICS = {
  quotes: ['quotesBot', 'quotesWeb'],
  claimsBlocked: ['claimsBlockedNoPolicy', 'claimsBlockedRejectedPayment', 'claimsBlockedOverdue'],
} as const satisfies Record<string, readonly BalanceMetric[]>

export type BalanceResponseMetric = BalanceMetric | keyof typeof DERIVED_METRICS

const RESPONSE_METRICS: BalanceResponseMetric[] = [
  ...BALANCE_METRICS,
  ...(Object.keys(DERIVED_METRICS) as Array<keyof typeof DERIVED_METRICS>),
]

export interface BalanceMetricValue {
  /** Null = not recorded that month ("sin dato"). */
  value: number | null
  /** The same metric the month before (null when it was not recorded). */
  previous: number | null
  change: number | null
  /** Change over the previous month in percent, 1 decimal; null without a previous value or from 0. */
  changePct: number | null
}

export interface BalanceMonth {
  period: string
  /** False = no balance was taken that month: every metric is null. */
  recorded: boolean
  /** Rebuilt after the fact: month-end metrics are null. */
  backfilled: boolean
  snapshotAt: Date | null
  metrics: Record<BalanceResponseMetric, BalanceMetricValue>
}

export interface BalanceResponse {
  months: BalanceMonth[]
}

const METRIC_SELECT = Object.fromEntries(BALANCE_METRICS.map(metric => [metric, true])) as Record<BalanceMetric, true>

type MonthTotals = {
  backfilled: boolean
  snapshotAt: Date | null
  values: Record<BalanceResponseMetric, number | null>
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals

/** Adds values; one unknown makes the total unknown. */
function sumKnown(values: Array<number | null>): number | null {
  return values.some(v => v == null) ? null : values.reduce<number>((sum, v) => sum + (v as number), 0)
}

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The last `months` closed months over the given codes, oldest first, each
   * metric with its change against the month before.
   */
  async getBalance(producerId: number, codeIds: number[], months: number, now = new Date()): Promise<BalanceResponse> {
    // One month more, to compare the first one shown.
    const periods = closedPeriods(months + 1, now)
    const rows = codeIds.length
      ? await this.prisma.monthlyBalance.findMany({
          where: { producerId, deletedAt: null, producerCodeId: { in: codeIds }, period: { in: periods } },
          select: { period: true, backfilled: true, snapshotAt: true, ...METRIC_SELECT },
        })
      : []

    const totals = periods.map(period => this.totalsOf(rows.filter(row => row.period === period)))
    return {
      months: periods.slice(1).map((period, i) => {
        const current = totals[i + 1]
        const previous = totals[i]
        const metrics = Object.fromEntries(
          RESPONSE_METRICS.map(metric => [
            metric,
            this.compare(metric, current?.values[metric] ?? null, previous?.values[metric] ?? null),
          ]),
        ) as Record<BalanceResponseMetric, BalanceMetricValue>
        return {
          period,
          recorded: current !== null,
          backfilled: current?.backfilled ?? false,
          snapshotAt: current?.snapshotAt ?? null,
          metrics,
        }
      }),
    }
  }

  /** One month summed over its rows; null when the month has none. */
  private totalsOf(
    rows: Array<{ backfilled: boolean; snapshotAt: Date } & Record<BalanceMetric, unknown>>,
  ): MonthTotals | null {
    if (!rows.length) return null
    const values = {} as Record<BalanceResponseMetric, number | null>
    for (const metric of BALANCE_METRICS) {
      const total = sumKnown(rows.map(row => (row[metric] == null ? null : Number(row[metric]))))
      values[metric] = total == null ? null : round(total, MONEY_METRICS.has(metric) ? 2 : 0)
    }
    for (const metric of Object.keys(DERIVED_METRICS) as Array<keyof typeof DERIVED_METRICS>) {
      const parts: readonly BalanceMetric[] = DERIVED_METRICS[metric]
      values[metric] = sumKnown(parts.map(part => values[part]))
    }
    return {
      backfilled: rows.some(row => row.backfilled),
      snapshotAt: rows.reduce<Date | null>(
        (latest, row) => (!latest || row.snapshotAt > latest ? row.snapshotAt : latest),
        null,
      ),
      values,
    }
  }

  private compare(metric: BalanceResponseMetric, value: number | null, previous: number | null): BalanceMetricValue {
    const decimals = MONEY_METRICS.has(metric as BalanceMetric) ? 2 : 0
    const change = value != null && previous != null ? round(value - previous, decimals) : null
    const changePct = change != null && previous ? round((change / Math.abs(previous)) * 100, 1) : null
    return { value, previous, change, changePct }
  }
}
