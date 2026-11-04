import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { MonthlyCloseService, MonthNumber, MonthSnapshot, previousPeriod } from '../monthly-close/monthly-close.service'
import { currentPeriod } from '../usage/usage.service'
import { settle, SettlementTerms } from './settlement-terms'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const round2 = (n: number): number => Math.round(n * 100) / 100

/** The money of a month, a number or an organization in the settlement. */
export interface SettlementAmounts {
  consumedMessages: number
  billedUsd: number
  /** Lumarsoft's service cost: consumed messages × cost per message. */
  serviceCostUsd: number
  /** billed − service cost. */
  remainderUsd: number
  partnerShareUsd: number
  ownerShareUsd: number
  /** What Lumarsoft keeps: its service cost plus its share of the remainder. */
  ownerTotalUsd: number
}

const zero = (): SettlementAmounts => ({
  consumedMessages: 0,
  billedUsd: 0,
  serviceCostUsd: 0,
  remainderUsd: 0,
  partnerShareUsd: 0,
  ownerShareUsd: 0,
  ownerTotalUsd: 0,
})

/** A number's settlement: frozen by its close, or with today's terms (live month, or closed without terms). */
function amountsOf(n: MonthNumber, terms: SettlementTerms): SettlementAmounts {
  const settlement = n.settlement ?? settle(n.billedUsd, n.consumedMessages, terms)
  return {
    consumedMessages: n.consumedMessages,
    billedUsd: n.billedUsd,
    serviceCostUsd: settlement.serviceCostUsd,
    remainderUsd: settlement.remainderUsd,
    partnerShareUsd: settlement.partnerShareUsd,
    ownerShareUsd: settlement.ownerShareUsd,
    ownerTotalUsd: round2(settlement.serviceCostUsd + settlement.ownerShareUsd),
  }
}

function add(rows: SettlementAmounts[]): SettlementAmounts {
  const sum = zero()
  for (const row of rows) for (const key of Object.keys(sum) as (keyof SettlementAmounts)[]) sum[key] += row[key]
  for (const key of Object.keys(sum) as (keyof SettlementAmounts)[])
    if (key !== 'consumedMessages') sum[key] = round2(sum[key])
  return sum
}

/** A number counts in the settlement when it was in service, consumed messages or billed something that month. */
const settled = (n: MonthNumber): boolean => n.inService || n.consumedMessages > 0 || n.billedUsd !== 0

/** `count` months ending at `to`, oldest first. */
function periodsEndingAt(to: string, count: number): string[] {
  const periods = [to]
  while (periods.length < count) periods.unshift(previousPeriod(periods[0]))
  return periods
}

/**
 * "Liquidación" (owner only): how each month's billing splits between Lumarsoft and its commercial partner.
 *
 * For every number, Lumarsoft charges a service cost per consumed message (PARTNER_COST_PER_MESSAGE_USD; a template
 * that counts twice costs twice); what the month billed minus that cost is the remainder, and the partner gets
 * PARTNER_PROFIT_SHARE of it. A trial bills 0, so its cost makes the remainder negative and comes out of the split.
 * What Meta and OpenAI really cost is not part of it and is never returned here (the Tablero has it). A closed month
 * is read with the rates it was frozen with; the running month uses today's. Without the terms in the environment
 * the settlement is not configured and every endpoint answers 503.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly closes: MonthlyCloseService) {}

  /** One month: totals, per organization, and per number. */
  async month(period = currentPeriod()) {
    this.assertPeriod(period)
    const terms = this.configuredTerms()
    const month = await this.closes.monthSnapshot(period)
    const numbers = month.numbers.filter(settled)

    const organizations = month.organizations.flatMap(org => {
      const own = numbers.filter(n => n.producerId === org.id)
      if (own.length === 0) return []
      const rows = own.map(n => ({
        id: n.phoneNumberId,
        number: n.number,
        isActive: n.isActive,
        responsibleCode: n.responsibleCode,
        plan: { name: n.plan.name, includedMessages: n.plan.includedMessages, priceUsd: n.plan.priceUsd },
        trial: n.plan.trial,
        prorated: n.prorated,
        firstMonth: n.firstMonth,
        sentMessages: n.messages,
        templateMessages: n.templateMessages,
        ...amountsOf(n, terms),
      }))
      return [{ id: org.id, name: org.name, isActive: org.isActive, numbers: rows, totals: add(rows) }]
    })

    return {
      period,
      live: period === currentPeriod(),
      closed: month.closed,
      closedAt: month.closedAt?.toISOString() ?? null,
      backfilled: month.backfilled,
      terms: this.termsOf(month, terms),
      totals: {
        organizations: organizations.length,
        numbers: numbers.length,
        trialNumbers: numbers.filter(n => n.plan.trial).length,
        ...add(numbers.map(n => amountsOf(n, terms))),
      },
      organizations,
    }
  }

  /**
   * The last `months` months ending at `to`: the money of each, how many numbers were active, how many started and
   * how many stopped (in service the month before, not this one).
   */
  async series(to = currentPeriod(), months = 12) {
    this.assertPeriod(to)
    const terms = this.configuredTerms()
    const periods = periodsEndingAt(to, months + 1)
    const snapshots = await this.closes.monthSnapshots(periods)
    const inService = snapshots.map(s => new Set(s.numbers.filter(n => n.inService).map(n => n.phoneNumberId)))
    const running = currentPeriod()

    return {
      to,
      terms,
      months: snapshots.slice(1).map((month, i) => {
        const active = inService[i + 1]
        const before = inService[i]
        return {
          period: month.period,
          live: month.period === running,
          closed: month.closed,
          backfilled: month.backfilled,
          ...add(month.numbers.filter(settled).map(n => amountsOf(n, terms))),
          activeNumbers: active.size,
          newNumbers: month.numbers.filter(n => n.inService && n.firstMonth).length,
          stoppedNumbers: [...before].filter(id => !active.has(id)).length,
        }
      }),
    }
  }

  /** The rates a month was settled with: its close's, or today's for a month computed now (or closed without them). */
  private termsOf(month: MonthSnapshot, today: SettlementTerms): SettlementTerms {
    const frozen = month.closed ? month.numbers.find(n => n.settlement)?.settlement : undefined
    return frozen ? { costPerMessageUsd: frozen.costPerMessageUsd, partnerShare: frozen.partnerShare } : today
  }

  /** Today's terms, or 503 when the server has none (PARTNER_COST_PER_MESSAGE_USD and PARTNER_PROFIT_SHARE). */
  private configuredTerms(): SettlementTerms {
    if (!this.closes.terms) throw new ServiceUnavailableException('La liquidación no está configurada en el servidor.')
    return this.closes.terms
  }

  private assertPeriod(period: string) {
    if (!PERIOD_RE.test(period) || period > currentPeriod()) throw new BadRequestException('Mes inválido')
  }
}
