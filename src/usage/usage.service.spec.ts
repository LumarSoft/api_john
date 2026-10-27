import { ConfigService } from '@nestjs/config'
import { UsageService, currentPeriod } from './usage.service'

function setup(phoneOverrides: Record<string, unknown> = {}) {
  const phone = {
    id: 4,
    producerId: 2,
    responsibleProducerCodeId: 8,
    isActive: true,
    monthlyBudgetUsd: 200,
    budgetExceededAt: null,
    ...phoneOverrides,
  }
  const events = new Set<string>()
  let openaiCost = 0
  const counters = { openaiInputTokens: 0, openaiOutputTokens: 0, openaiCalls: 0, metaMessages: 0 }
  const prisma = {
    phoneNumber: { findFirst: jest.fn().mockResolvedValue(phone), update: jest.fn() },
    usageEvent: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (events.has(data.eventId)) throw { code: 'P2002' }
        events.add(data.eventId)
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    usageMonthly: {
      upsert: jest.fn().mockImplementation(async ({ create }) => {
        openaiCost += create.openaiCostUsd ?? 0
        for (const key of Object.keys(counters)) counters[key] += create[key] ?? 0
        return { id: 9, openaiCostUsd: openaiCost, ...counters }
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      // The number has been in service since September.
      groupBy: jest.fn().mockResolvedValue([{ phoneNumberId: 4, _min: { period: '2026-09' } }]),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(fn => fn(prisma))
  const service = new UsageService(prisma as any, { get: () => undefined } as unknown as ConfigService)
  return { service, prisma }
}

const live = { isActive: true, serviceStartedAt: new Date('2026-08-10T15:00:00Z') }

describe('token plans', () => {
  it('picks the smallest plan that covers the tokens, in blocks of 1,000 at USD 50', () => {
    const { service } = setup()
    expect(service.planFor(0)).toEqual({ blocks: 1, name: 'Inicial', includedTokens: 1000, priceUsd: 50 })
    expect(service.planFor(1000)).toMatchObject({ name: 'Inicial', priceUsd: 50 })
    expect(service.planFor(1001)).toMatchObject({ blocks: 2, name: 'Estándar', includedTokens: 2000, priceUsd: 100 })
    expect(service.planFor(2001)).toMatchObject({ name: 'Profesional', priceUsd: 150 })
    expect(service.planFor(4000)).toMatchObject({ name: 'Avanzado', priceUsd: 200 })
    expect(service.planFor(4500)).toEqual({
      blocks: 5,
      name: 'Avanzado + 1.000',
      includedTokens: 5000,
      priceUsd: 250,
    })
  })

  it('counts one token per message sent and ignores LLM tokens', () => {
    const { service } = setup()
    expect(service.billFor(live, { metaMessages: 1430, openaiInputTokens: 5_000_000 }, '2026-10')).toMatchObject({
      tokens: 1430,
      plan: { name: 'Estándar' },
      billedUsd: 100,
      prorated: false,
    })
  })

  it('charges the Inicial plan for a quiet month and recalculates the plan every month', () => {
    const { service } = setup()
    expect(service.billFor(live, undefined, '2026-09').billedUsd).toBe(50)
    expect(service.billFor(live, { metaMessages: 2150 }, '2026-09').billedUsd).toBe(150)
    expect(service.billFor(live, { metaMessages: 820 }, '2026-10').billedUsd).toBe(50)
  })

  it('does not bill a number before it goes live, nor a switched-off number that sent nothing', () => {
    const { service } = setup()
    expect(service.billFor({ isActive: true, serviceStartedAt: null }, undefined, '2026-10').billedUsd).toBe(0)
    expect(service.billFor(live, undefined, '2026-07').billedUsd).toBe(0)
    expect(service.billFor({ ...live, isActive: false }, undefined, '2026-10').billedUsd).toBe(0)
    expect(service.billFor({ ...live, isActive: false }, { metaMessages: 1500 }, '2026-10').billedUsd).toBe(100)
  })

  it('prorates only the Inicial plan of the first month, from the day the number went live', () => {
    const { service } = setup()
    // 21 October in Argentina: 11 of 31 days in service.
    const startedOct21 = { isActive: true, serviceStartedAt: new Date('2026-10-21T13:00:00Z') }
    expect(service.billFor(startedOct21, { metaMessages: 300 }, '2026-10')).toMatchObject({
      billedUsd: 17.74,
      prorated: true,
    })
    expect(service.billFor(startedOct21, { metaMessages: 1500 }, '2026-10')).toMatchObject({
      billedUsd: 100,
      prorated: false,
    })
    expect(service.billFor(startedOct21, { metaMessages: 300 }, '2026-11').billedUsd).toBe(50)
    // 30 September 22:00 in Argentina is still September: October is a full month.
    const startedSep30 = { isActive: true, serviceStartedAt: new Date('2026-10-01T01:00:00Z') }
    expect(service.billFor(startedSep30, undefined, '2026-10').billedUsd).toBe(50)
    expect(service.billFor(startedSep30, undefined, '2026-09')).toMatchObject({ billedUsd: 1.67, prorated: true })
  })

  it('dates the start of service from the first event of the first month, or that month when it has none', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.groupBy.mockResolvedValue([
      { phoneNumberId: 1, _min: { period: '2026-09' } },
      { phoneNumberId: 2, _min: { period: '2026-10' } },
    ])
    prisma.usageEvent.groupBy.mockResolvedValue([
      { phoneNumberId: 2, _min: { deliveredAt: new Date('2026-10-21T13:00:00Z') } },
    ])
    const starts = await service.serviceStarts([1, 2, 3])
    expect(prisma.usageEvent.groupBy.mock.calls[0][0].where).toEqual({
      OR: [
        { phoneNumberId: 1, period: '2026-09' },
        { phoneNumberId: 2, period: '2026-10' },
      ],
    })
    expect(starts.get(1)).toEqual(new Date('2026-09-01T03:00:00Z'))
    expect(starts.get(2)).toEqual(new Date('2026-10-21T13:00:00Z'))
    expect(starts.has(3)).toBe(false)
  })
})

describe('monthly usage recording', () => {
  it('uses Argentina local time at the month boundary', () => {
    expect(currentPeriod(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09')
    expect(currentPeriod(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10')
  })

  it('preserves provider-free Meta cost while counting every message as a token', async () => {
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

  it('stores the next plan once a month passes the tokens of its plan', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 1001 })
    await service.recordMeta({
      metaPhoneNumberId: 'PN',
      messageId: 'm-1001',
      category: 'service',
      recipient: '5493416000000',
      timestamp: Date.parse('2026-10-20T12:00:00Z') / 1000,
      billable: true,
    })
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 100 } })
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

  it('reports each number with its tokens, plan and margin', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.findMany.mockResolvedValue([
      {
        totalCostUsd: 10,
        openaiCostUsd: 2,
        metaCostUsd: 8,
        billedUsd: 50,
        metaMessages: 1430,
        phoneNumber: { id: 4, isActive: true },
      },
    ])
    const report = await service.getSummary(2, [8], '2026-10')
    expect(report.rows[0]).toMatchObject({ tokens: 1430, plan: { name: 'Estándar' }, billedUsd: 100, marginUsd: 90 })
    expect(report.totals).toMatchObject({ billedUsd: 100, marginUsd: 90 })
  })
})

describe('OpenAI budget', () => {
  it('cuts the LLM on OpenAI spend only, never on Meta messages the client pays as tokens', async () => {
    const { service, prisma } = setup({ monthlyBudgetUsd: 1 })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0.2, metaMessages: 3000 })
    const meta = await service.recordMeta({
      metaPhoneNumberId: 'PN',
      messageId: 'busy',
      category: 'service',
      recipient: '5493416000000',
      timestamp: Date.now() / 1000,
      billable: true,
    })
    expect(meta.overBudget).toBe(false)
    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()

    prisma.usageMonthly.findUnique.mockResolvedValue({ openaiCostUsd: 0.2 })
    await expect(service.isLlmEnabled('PN')).resolves.toBe(true)
    prisma.usageMonthly.findUnique.mockResolvedValue({ openaiCostUsd: 1.5 })
    await expect(service.isLlmEnabled('PN')).resolves.toBe(false)
  })
})
