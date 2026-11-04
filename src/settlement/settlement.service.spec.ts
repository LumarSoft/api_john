import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import type { MonthlyCloseService, MonthNumber, MonthSnapshot } from '../monthly-close/monthly-close.service'
import { currentPeriod } from '../usage/usage.service'
import { settle, SettlementTerms } from './settlement-terms'
import { SettlementService } from './settlement.service'

// Illustrative rates: the real ones live only in the server's .env.
const terms = { costPerMessageUsd: 0.03, partnerShare: 0.4 }

function number(id: number, producerId: number, values: Partial<MonthNumber> = {}): MonthNumber {
  const billedUsd = values.billedUsd ?? 25
  const consumed = values.consumedMessages ?? 300
  return {
    phoneNumberId: id,
    producerId,
    producerCodeId: null,
    number: `+54 9 341 000-00${id}`,
    branchName: null,
    isActive: true,
    responsibleCode: null,
    plan: { id: 1, name: 'Inicial', includedMessages: 500, priceUsd: 25, trial: false, extraBlocks: 0 },
    assignedPlan: null,
    upgraded: false,
    prorated: false,
    paused: false,
    inService: true,
    firstMonth: false,
    messages: consumed,
    templateMessages: 0,
    consumedMessages: consumed,
    metaBillableMessages: 40,
    metaCostUsd: 1.04,
    openaiCostUsd: 2.5,
    billedUsd,
    settlement: settle(billedUsd, consumed, terms),
    ...values,
  }
}

const organizations = [
  { id: 1, name: 'Organización A', isActive: true },
  { id: 2, name: 'Organización B', isActive: true },
  { id: 3, name: 'Sin números', isActive: true },
]

function month(period: string, numbers: MonthNumber[], closed = false): MonthSnapshot {
  return {
    period,
    closed,
    closedAt: closed ? new Date('2026-10-01T03:00:00Z') : null,
    backfilled: false,
    organizations,
    numbers,
  }
}

function setup(snapshots: MonthSnapshot[], today: SettlementTerms | null = terms) {
  const closes = {
    terms: today,
    monthSnapshot: jest.fn().mockImplementation((period: string) => snapshots.find(s => s.period === period)),
    monthSnapshots: jest
      .fn()
      .mockImplementation((periods: string[]) =>
        periods.map(period => snapshots.find(s => s.period === period) ?? month(period, [])),
      ),
  }
  return { service: new SettlementService(closes as unknown as MonthlyCloseService), closes }
}

describe('the settlement of a month', () => {
  it('adds up billed, cost, remainder and both shares per number, organization and month', async () => {
    const trial = number(9, 2, {
      plan: { id: 9, name: 'Prueba', includedMessages: 100, priceUsd: 0, trial: true, extraBlocks: 0 },
      billedUsd: 0,
      consumedMessages: 80,
      firstMonth: true,
    })
    const { service } = setup([
      month('2026-10', [
        number(8, 1, { templateMessages: 50, messages: 250, consumedMessages: 300 }),
        trial,
        // Connected but not in service, nothing consumed or billed: left out.
        number(10, 2, { inService: false, billedUsd: 0, consumedMessages: 0 }),
      ]),
    ])
    const result = await service.month('2026-10')
    expect(result).toMatchObject({ period: '2026-10', closed: false, terms })
    expect(result.organizations.map(o => o.name)).toEqual(['Organización A', 'Organización B'])
    expect(result.organizations[0].numbers[0]).toMatchObject({
      plan: { name: 'Inicial', includedMessages: 500, priceUsd: 25 },
      sentMessages: 250,
      templateMessages: 50,
      consumedMessages: 300,
      billedUsd: 25,
      serviceCostUsd: 9,
      remainderUsd: 16,
      partnerShareUsd: 6.4,
      ownerShareUsd: 9.6,
      ownerTotalUsd: 18.6,
    })
    expect(result.organizations[1].totals).toMatchObject({
      billedUsd: 0,
      serviceCostUsd: 2.4,
      remainderUsd: -2.4,
      partnerShareUsd: -0.96,
      ownerShareUsd: -1.44,
      ownerTotalUsd: 0.96,
    })
    expect(result.totals).toEqual({
      organizations: 2,
      numbers: 2,
      trialNumbers: 1,
      consumedMessages: 380,
      billedUsd: 25,
      serviceCostUsd: 11.4,
      remainderUsd: 13.6,
      partnerShareUsd: 5.44,
      ownerShareUsd: 8.16,
      ownerTotalUsd: 19.56,
    })
  })

  it('never returns what Meta or OpenAI cost', async () => {
    const { service } = setup([month('2026-10', [number(8, 1)])])
    const json = JSON.stringify(await service.month('2026-10'))
    for (const field of ['metaCostUsd', 'openaiCostUsd', 'metaBillableMessages']) expect(json).not.toContain(field)
  })

  it('settles a closed month with the rates it was frozen with', async () => {
    const frozen = { costPerMessageUsd: 0.05, partnerShare: 0.25 }
    const row = number(8, 1, { settlement: settle(25, 300, frozen) })
    const { service } = setup([month('2026-09', [row], true)])
    const result = await service.month('2026-09')
    expect(result).toMatchObject({ closed: true, closedAt: '2026-10-01T03:00:00.000Z', terms: frozen })
    expect(result.totals).toMatchObject({ serviceCostUsd: 15, remainderUsd: 10, partnerShareUsd: 2.5 })
  })

  it("settles with today's rates a month closed before the terms were configured", async () => {
    const row = number(8, 1, { settlement: null })
    const { service } = setup([month('2026-09', [row], true)])
    const result = await service.month('2026-09')
    expect(result).toMatchObject({ closed: true, terms })
    expect(result.totals).toMatchObject({ serviceCostUsd: 9, remainderUsd: 16, partnerShareUsd: 6.4 })
  })

  it('answers 503 while the settlement terms are not configured', async () => {
    const { service, closes } = setup([month('2026-10', [number(8, 1, { settlement: null })])], null)
    await expect(service.month('2026-10')).rejects.toThrow(ServiceUnavailableException)
    await expect(service.month('2026-10')).rejects.toThrow('La liquidación no está configurada en el servidor.')
    await expect(service.series('2026-10')).rejects.toThrow(ServiceUnavailableException)
    expect(closes.monthSnapshot).not.toHaveBeenCalled()
    expect(closes.monthSnapshots).not.toHaveBeenCalled()
  })

  it('rejects a malformed or future month', async () => {
    const { service } = setup([])
    await expect(service.month('2026-13')).rejects.toThrow(BadRequestException)
    await expect(service.month('2999-01')).rejects.toThrow(BadRequestException)
    await expect(service.series('2999-01')).rejects.toThrow(BadRequestException)
  })
})

describe('the settlement series', () => {
  it('lists twelve months with the active, new and stopped numbers of each', async () => {
    const to = currentPeriod()
    const { service, closes } = setup([])
    const periods: string[] = []
    closes.monthSnapshots.mockImplementation((asked: string[]) => {
      periods.push(...asked)
      return asked.map((period, i) => {
        // Number 8 every month; number 9 from the second month listed to the third from the end.
        const rows = [number(8, 1)]
        if (i >= 2 && i <= asked.length - 3) rows.push(number(9, 2, { firstMonth: i === 2 }))
        return month(period, rows, i < asked.length - 1)
      })
    })
    const result = await service.series(to)
    expect(periods).toHaveLength(13)
    expect(result.months).toHaveLength(12)
    expect(result.months.at(-1)).toMatchObject({ period: to, live: true, closed: false })
    // The month number 9 starts: 2 active, 1 new.
    expect(result.months[1]).toMatchObject({ activeNumbers: 2, newNumbers: 1, stoppedNumbers: 0 })
    // The month after its last: 1 active, 1 stopped.
    expect(result.months.at(-2)).toMatchObject({ activeNumbers: 1, newNumbers: 0, stoppedNumbers: 1 })
    expect(result.months[5]).toMatchObject({
      billedUsd: 50,
      serviceCostUsd: 18,
      remainderUsd: 32,
      partnerShareUsd: 12.8,
      ownerShareUsd: 19.2,
      ownerTotalUsd: 37.2,
    })
  })
})
