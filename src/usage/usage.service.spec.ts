import { ConfigService } from '@nestjs/config'
import { UsageService, currentPeriod } from './usage.service'

function setup() {
  const phone = { id: 4, producerId: 2, responsibleProducerCodeId: 8, monthlyBudgetUsd: 200, budgetExceededAt: null }
  const events = new Set<string>()
  let total = 0
  const counters = { openaiInputTokens: 0, openaiOutputTokens: 0, openaiCalls: 0, metaMessages: 0 }
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
        for (const key of Object.keys(counters)) counters[key] += create[key] ?? 0
        return { id: 9, totalCostUsd: total, ...counters }
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
  it('charges nothing without use and enforces the full-month commercial range', () => {
    const { service } = setup()
    expect(service.priceFor({}, undefined, '2026-08')).toBe(0)
    expect(service.priceFor({}, { openaiInputTokens: 0, metaMessages: 0 }, '2026-08')).toBe(0)
    expect(service.priceFor({}, { openaiInputTokens: 1000 }, '2026-08')).toBe(50)
    expect(service.priceFor({}, { openaiInputTokens: 10_000_000 }, '2026-08')).toBe(100)
  })

  it('prices 62,218 tokens daily for 30 days at approximately USD 70', () => {
    const { service } = setup()
    expect(service.priceFor({}, { openaiInputTokens: 62_218 * 30 }, '2026-08')).toBe(70)
    expect(service.priceFor({}, { openaiInputTokens: 60_000 * 30 }, '2026-08')).toBe(67.5)
    expect(service.priceFor({}, { openaiInputTokens: 62_218 * 30, metaMessages: 100 }, '2026-08')).toBe(77.8)
  })

  it('prorates only the minimum during the running month, never the consumed amount', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T03:00:00Z'))
    try {
      const { service } = setup()
      expect(service.priceFor({}, { openaiInputTokens: 62_218 }, '2026-10')).toBe(2.33)
      expect(service.priceFor({}, { openaiInputTokens: 1_000 }, '2026-10')).toBe(1.61)
      expect(service.priceFor({}, { metaMessages: 1_000 }, '2026-10')).toBe(78)
      expect(service.priceFor({}, {}, '2026-10')).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('uses Argentina local time at the month boundary', () => {
    expect(currentPeriod(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09')
    expect(currentPeriod(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10')
  })

  it('preserves provider-free Meta cost while charging all messages commercially', async () => {
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
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 50 } })
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

  it('prices a transcription per minute of audio, not per token', async () => {
    const { service, prisma } = setup()
    await service.recordOpenAI({
      metaPhoneNumberId: 'PN',
      model: 'gpt-transcribe',
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 90,
    })
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create.openaiCostUsd).toBeCloseTo(0.00675, 8)
  })

  it('rejects a model without a configured rate', async () => {
    const { service } = setup()
    await expect(
      service.recordOpenAI({ metaPhoneNumberId: 'PN', model: 'otro-modelo', inputTokens: 1, outputTokens: 1 }),
    ).rejects.toThrow('Tarifa no configurada')
  })

  it('does not prorate monthly recorded consumption by elapsed days', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.findMany.mockResolvedValue([
      {
        totalCostUsd: 10,
        openaiCostUsd: 2,
        metaCostUsd: 8,
        billedUsd: 50,
        openaiInputTokens: 62_218 * 30,
        phoneNumber: {},
      },
    ])
    const report = await service.getSummary(2, [8], '2026-09')
    expect(report.rows[0]).toMatchObject({ billedUsd: 70, accruedUsd: 70, marginUsd: 60 })
  })
})
