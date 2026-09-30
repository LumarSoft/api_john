import { ConfigService } from '@nestjs/config'
import { UsageService, currentPeriod } from './usage.service'

function setup() {
  const phone = { id: 4, producerId: 2, responsibleProducerCodeId: 8, monthlyBudgetUsd: 200, budgetExceededAt: null }
  const events = new Set<string>()
  let total = 0
  const prisma = {
    phoneNumber: { findFirst: jest.fn().mockResolvedValue(phone), update: jest.fn() },
    usageEvent: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (events.has(data.eventId)) throw { code: 'P2002' }
        events.add(data.eventId)
      }),
    },
    usageMonthly: {
      upsert: jest.fn().mockImplementation(async ({ create }) => {
        total += create.totalCostUsd
        return { id: 9, totalCostUsd: total }
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(fn => fn(prisma))
  const service = new UsageService(prisma as any, { get: () => undefined } as unknown as ConfigService)
  return { service, prisma }
}

describe('monthly usage billing', () => {
  it('uses cost times three regardless of old plan floors and ceilings', () => {
    const { service } = setup()
    const phone = { monthlyBasePriceUsd: 50, monthlyMaxPriceUsd: 70 }
    expect(service.priceFor(phone, 0)).toBe(0)
    expect(service.priceFor(phone, 2)).toBe(6)
    expect(service.priceFor(phone, 100)).toBe(300)
  })

  it('uses Argentina local time at the month boundary', () => {
    expect(currentPeriod(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09')
    expect(currentPeriod(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10')
  })

  it('charges only billable Meta messages and counts free messages at zero cost', async () => {
    const { service, prisma } = setup()
    const data = {
      metaPhoneNumberId: 'PN',
      category: 'service',
      recipient: '5493416000000',
      timestamp: Date.parse('2026-10-02T12:00:00Z') / 1000,
    }
    await service.recordMeta({ ...data, messageId: 'one', billable: false })
    await service.recordMeta({ ...data, messageId: 'two', billable: true })
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create).toMatchObject({
      metaMessages: 1,
      metaBillableMessages: 0,
      totalCostUsd: 0,
      period: '2026-10',
    })
    expect(prisma.usageMonthly.upsert.mock.calls[1][0].create).toMatchObject({
      metaMessages: 1,
      metaBillableMessages: 1,
      totalCostUsd: 0.026,
    })
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 0.08 } })
  })

  it('deduplicates status retries durably by phone/message id', async () => {
    const { service, prisma } = setup()
    const data = {
      metaPhoneNumberId: 'PN',
      messageId: 'same',
      category: 'marketing',
      recipient: '5493416000000',
      timestamp: 1791000000,
      billable: true,
    }
    await service.recordMeta(data)
    await service.recordMeta(data)
    expect(prisma.usageMonthly.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create.metaCostUsd).toBe(0.0618)
  })

  it('prices every OpenAI call from Luna tokens, including cached input', async () => {
    const { service, prisma } = setup()
    const data = {
      metaPhoneNumberId: 'PN',
      requestId: 'completion-1',
      model: 'gpt-5.6-luna',
      inputTokens: 100000,
      cachedInputTokens: 50000,
      outputTokens: 10000,
    }
    await service.recordOpenAI(data)
    await service.recordOpenAI(data)
    expect(prisma.usageMonthly.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create).toMatchObject({
      openaiCalls: 1,
      openaiCachedInputTokens: 50000,
    })
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create.openaiCostUsd).toBeCloseTo(0.023, 8)
  })

  it('applies Luna long-context token rates per call', async () => {
    const { service, prisma } = setup()
    await service.recordOpenAI({ metaPhoneNumberId: 'PN', inputTokens: 300000, outputTokens: 10000 })
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create.openaiCostUsd).toBeCloseTo(0.138, 8)
  })

  it('does not prorate monthly recorded consumption by elapsed days', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.findMany.mockResolvedValue([
      { totalCostUsd: 10, openaiCostUsd: 2, metaCostUsd: 8, billedUsd: 50, phoneNumber: {} },
    ])
    const report = await service.getSummary(2, [8], '2026-09')
    expect(report.rows[0]).toMatchObject({ billedUsd: 30, accruedUsd: 30, marginUsd: 20 })
  })
})
