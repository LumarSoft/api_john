import type { PrismaService } from '../prisma/prisma.service'
import { BALANCE_METRICS, type BalanceMetric } from './balance-metrics'
import { BalanceService } from './balance.service'

const NOW = new Date('2026-11-04T12:00:00Z')

/** A stored row: every metric 0 unless given. */
function row(period: string, values: Partial<Record<BalanceMetric, number | string | null>>, backfilled = false) {
  return {
    period,
    backfilled,
    snapshotAt: new Date(`${period}-28T12:00:00Z`),
    ...Object.fromEntries(BALANCE_METRICS.map(metric => [metric, 0])),
    ...values,
  }
}

function setup(rows: ReturnType<typeof row>[]) {
  const findMany = jest.fn().mockResolvedValue(rows)
  const service = new BalanceService({ monthlyBalance: { findMany } } as unknown as PrismaService)
  return { findMany, service }
}

describe('BalanceService.getBalance', () => {
  it('reads only the codes the user sees, one month more to compare the first', async () => {
    const { findMany, service } = setup([])
    await service.getBalance(5, [10, 20], 2, NOW)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          producerId: 5,
          deletedAt: null,
          producerCodeId: { in: [10, 20] },
          period: { in: ['2026-08', '2026-09', '2026-10'] },
        },
      }),
    )
  })

  it('reads nothing when the user sees no code', async () => {
    const { findMany, service } = setup([])
    const result = await service.getBalance(5, [], 1, NOW)
    expect(findMany).not.toHaveBeenCalled()
    expect(result.months).toEqual([expect.objectContaining({ period: '2026-10', recorded: false })])
  })

  it('adds the codes up and compares each month with the one before', async () => {
    const { service } = setup([
      row('2026-09', { policiesInForce: 100, debtAmount: '1000.10', quotesBot: 2, quotesWeb: 1 }),
      row('2026-09', { policiesInForce: 50, debtAmount: '500.00' }),
      row('2026-10', { policiesInForce: 160, debtAmount: '1200.35', quotesBot: 5, quotesWeb: 1 }),
    ])

    const { months } = await service.getBalance(5, [10, 20], 1, NOW)

    expect(months).toHaveLength(1)
    expect(months[0]).toMatchObject({ period: '2026-10', recorded: true, backfilled: false })
    expect(months[0].metrics.policiesInForce).toEqual({ value: 160, previous: 150, change: 10, changePct: 6.7 })
    expect(months[0].metrics.debtAmount).toEqual({ value: 1200.35, previous: 1500.1, change: -299.75, changePct: -20 })
    expect(months[0].metrics.quotes).toEqual({ value: 6, previous: 3, change: 3, changePct: 100 })
  })

  it('shows "sin dato" for a metric a rebuilt month could not read, and no change against it', async () => {
    const { service } = setup([
      row('2026-08', { claimsOpen: null, claimsFiled: 4 }, true),
      row('2026-09', { claimsOpen: 3, claimsFiled: 2 }),
    ])

    const { months } = await service.getBalance(5, [10], 3, NOW)

    expect(months[0]).toMatchObject({ period: '2026-08', backfilled: true })
    expect(months[0].metrics.claimsOpen).toEqual({ value: null, previous: null, change: null, changePct: null })
    expect(months[1].metrics.claimsOpen).toEqual({ value: 3, previous: null, change: null, changePct: null })
    expect(months[1].metrics.claimsFiled).toEqual({ value: 2, previous: 4, change: -2, changePct: -50 })
  })

  it('leaves a month without a balance unrecorded instead of showing zeros', async () => {
    const { service } = setup([row('2026-09', { handoffs: 7 })])

    const { months } = await service.getBalance(5, [10], 2, NOW)

    expect(months.map(m => [m.period, m.recorded])).toEqual([
      ['2026-09', true],
      ['2026-10', false],
    ])
    expect(months[1].metrics.handoffs).toEqual({ value: null, previous: 7, change: null, changePct: null })
    expect(months[1].metrics.claimsBlocked.value).toBeNull()
  })

  it('does not compute a percentage from zero', async () => {
    const { service } = setup([row('2026-09', { handoffs: 0 }), row('2026-10', { handoffs: 4 })])
    const { months } = await service.getBalance(5, [10], 1, NOW)
    expect(months[0].metrics.handoffs).toEqual({ value: 4, previous: 0, change: 4, changePct: null })
  })
})
