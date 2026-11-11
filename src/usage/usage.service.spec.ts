import { ConfigService } from '@nestjs/config'
import { CatalogPlan, UsageService, consumedMessages, currentPeriod } from './usage.service'
import {
  campaignExtraMessages,
  isCampaignCategory,
  isTemplateCategory,
  readCommercialPricing,
} from './commercial-pricing'

const catalogRows = [
  { id: 9, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true },
  { id: 1, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true },
  { id: 2, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true },
]
const catalog: CatalogPlan[] = catalogRows

function setup(phoneOverrides: Record<string, unknown> = {}, settings: Record<string, string> = {}) {
  const phone = {
    id: 4,
    number: '+54 9 341 600-0000',
    phoneNumberId: 'PN',
    producerId: 2,
    responsibleProducerCodeId: 8,
    isActive: true,
    monthlyBudgetUsd: 200,
    budgetExceededAt: null,
    planId: null,
    planPausedAt: null,
    extraBlocks: 0,
    extraBlocksPeriod: null,
    ...phoneOverrides,
  }
  const events = new Set<string>()
  let openaiCost = 0
  const counters = { openaiInputTokens: 0, openaiOutputTokens: 0, openaiCalls: 0, metaMessages: 0 }
  const prisma = {
    phoneNumber: {
      findFirst: jest.fn().mockResolvedValue(phone),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    messagePlan: {
      findMany: jest.fn().mockResolvedValue(catalogRows),
      findFirst: jest.fn().mockResolvedValue({ id: 9 }),
    },
    producer: { findUnique: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([{ email: 'super@org.com' }]) },
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
  const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) }
  const config = { get: (key: string) => settings[key] } as unknown as ConfigService
  const service = new UsageService(prisma as any, config, mail as any)
  return { service, prisma, mail }
}

const live = { isActive: true, serviceStartedAt: new Date('2026-08-10T15:00:00Z'), planId: null }

describe('message plans', () => {
  it('bills the assigned plan while it covers the month, even a quiet one', () => {
    const { service } = setup()
    expect(service.billFor({ ...live, planId: 1 }, { metaMessages: 430 }, catalog, '2026-10')).toMatchObject({
      messages: 430,
      plan: { id: 1, name: 'Inicial', includedMessages: 500, priceUsd: 25 },
      upgraded: false,
      billedUsd: 25,
    })
    expect(service.billFor({ ...live, planId: 2 }, { metaMessages: 100 }, catalog, '2026-10')).toMatchObject({
      plan: { name: 'Profesional' },
      billedUsd: 50,
    })
  })

  it('puts a number nobody assigned on the smallest paid plan', () => {
    const { service } = setup()
    expect(service.billFor(live, undefined, catalog, '2026-09')).toMatchObject({
      assignedPlan: { name: 'Inicial' },
      plan: { name: 'Inicial' },
      billedUsd: 25,
    })
  })

  it('keeps a busier month on its plan, at its limit, and past the largest only on the blocks accepted', () => {
    const { service } = setup()
    expect(service.billFor({ ...live, planId: 1 }, { metaMessages: 600 }, catalog, '2026-10')).toMatchObject({
      assignedPlan: { name: 'Inicial' },
      plan: { id: 1, name: 'Inicial' },
      upgraded: false,
      limitReached: true,
      billedUsd: 25,
    })
    expect(service.billFor({ ...live, planId: 1 }, { metaMessages: 499 }, catalog, '2026-10').limitReached).toBe(false)
    expect(
      service.billFor({ ...live, planId: 2, extraBlocks: 1 }, { metaMessages: 1430 }, catalog, '2026-10'),
    ).toMatchObject({
      plan: { id: null, name: 'Profesional + 1.000', includedMessages: 2000, priceUsd: 100, extraBlocks: 1 },
      upgraded: true,
      limitReached: false,
      billedUsd: 100,
    })
    // planFor still prices the plan that would cover a month: the step past a plan.
    expect(service.planFor(1430, null, catalog)).toEqual({
      id: null,
      name: 'Profesional + 1.000',
      includedMessages: 2000,
      priceUsd: 100,
      trial: false,
      extraBlocks: 1,
    })
    expect(service.planFor(2500, null, catalog)).toMatchObject({ includedMessages: 3000, priceUsd: 150 })
    // A paid plan never lands on the trial, however few the messages.
    expect(service.planFor(50, null, catalog)).toMatchObject({ name: 'Inicial' })
  })

  it('offers the next plan at the limit, or one more block past the largest', () => {
    const { service } = setup()
    const inicial = { id: 1, name: 'Inicial', includedMessages: 500, priceUsd: 25, trial: false, extraBlocks: 0 }
    const profesional = {
      id: 2,
      name: 'Profesional',
      includedMessages: 1000,
      priceUsd: 50,
      trial: false,
      extraBlocks: 0,
    }
    expect(service.nextPlanAfter(inicial, catalog)).toEqual({ name: 'Profesional', messages: 1000, priceUsd: 50 })
    expect(service.nextPlanAfter(profesional, catalog)).toEqual({
      name: 'Profesional + 1.000',
      messages: 2000,
      priceUsd: 100,
    })
  })

  it('counts the messages sent and ignores LLM tokens', () => {
    const { service } = setup()
    expect(
      service.billFor(live, { metaMessages: 430, openaiInputTokens: 5_000_000 }, catalog, '2026-10'),
    ).toMatchObject({ messages: 430, plan: { name: 'Inicial' }, billedUsd: 25 })
  })

  it('keeps the trial free in the first month only, and stops a busy trial at its limit', () => {
    const { service } = setup()
    const trial = { isActive: true, serviceStartedAt: new Date('2026-11-03T15:00:00Z'), planId: 9 }
    expect(service.billFor(trial, { metaMessages: 80 }, catalog, '2026-11')).toMatchObject({
      plan: { name: 'Prueba', includedMessages: 100, priceUsd: 0, trial: true },
      billedUsd: 0,
      limitReached: false,
    })
    expect(service.billFor(trial, { metaMessages: 100 }, catalog, '2026-11')).toMatchObject({
      plan: { name: 'Prueba' },
      upgraded: false,
      limitReached: true,
      billedUsd: 0,
    })
    expect(service.billFor(trial, { metaMessages: 50 }, catalog, '2026-12')).toMatchObject({
      assignedPlan: { name: 'Inicial' },
      billedUsd: 25,
    })
    // Before its first message the number shows its trial.
    expect(service.billFor({ ...trial, serviceStartedAt: null }, undefined, catalog, '2026-10')).toMatchObject({
      plan: { name: 'Prueba' },
      billedUsd: 0,
    })
  })

  it('does not bill a number before it goes live, nor a switched-off number that sent nothing', () => {
    const { service } = setup()
    expect(service.billFor({ ...live, serviceStartedAt: null }, undefined, catalog, '2026-10').billedUsd).toBe(0)
    expect(service.billFor(live, undefined, catalog, '2026-07').billedUsd).toBe(0)
    expect(service.billFor({ ...live, isActive: false }, undefined, catalog, '2026-10').billedUsd).toBe(0)
    // Switched off after sending: its plan, whole.
    expect(service.billFor({ ...live, isActive: false }, { metaMessages: 600 }, catalog, '2026-10').billedUsd).toBe(25)
  })

  it('charges the whole calendar month, also the month a number goes live', () => {
    const { service } = setup()
    const startedOct21 = { isActive: true, serviceStartedAt: new Date('2026-10-21T13:00:00Z'), planId: null }
    // Live on the 21st: the whole Inicial plan, not the days left in the month.
    expect(service.billFor(startedOct21, { metaMessages: 100 }, catalog, '2026-10')).toMatchObject({
      plan: { name: 'Inicial' },
      billedUsd: 25,
    })
    // Live on the last day of the month: still the whole plan.
    const startedOct31 = { ...startedOct21, serviceStartedAt: new Date('2026-10-31T20:00:00Z') }
    expect(service.billFor(startedOct31, { metaMessages: 3 }, catalog, '2026-10').billedUsd).toBe(25)
    // Blocks accepted past the largest plan are charged whole too.
    expect(
      service.billFor({ ...startedOct21, planId: 2, extraBlocks: 1 }, { metaMessages: 1500 }, catalog, '2026-10'),
    ).toMatchObject({ plan: { name: 'Profesional + 1.000' }, billedUsd: 100 })
    expect(service.billFor(startedOct21, { metaMessages: 100 }, catalog, '2026-11').billedUsd).toBe(25)
    expect(service.billFor(startedOct21, { metaMessages: 100 }, catalog, '2026-10')).not.toHaveProperty('prorated')
  })

  it('keeps the numbers of a plan switched off on it but moves nobody to it, and drops a retired plan', () => {
    const { service } = setup()
    const withInicialOff = catalog.map(p => (p.id === 1 ? { ...p, isActive: false } : p))
    expect(service.billFor({ ...live, planId: 1 }, { metaMessages: 10 }, withInicialOff, '2026-10').plan.name).toBe(
      'Inicial',
    )
    expect(service.billFor(live, { metaMessages: 10 }, withInicialOff, '2026-10').plan.name).toBe('Profesional')
    expect(service.billFor({ ...live, planId: 77 }, { metaMessages: 10 }, catalog, '2026-10').plan.name).toBe('Inicial')
  })

  it("starts only a new account's numbers on the trial plan", async () => {
    const { service, prisma } = setup()
    prisma.producer.findUnique.mockResolvedValue({ createdAt: new Date('2026-06-01T00:00:00Z') })
    await expect(service.initialPlanIdFor(2)).resolves.toBeNull()
    prisma.producer.findUnique.mockResolvedValue({ createdAt: new Date('2026-11-01T00:00:00Z') })
    await expect(service.initialPlanIdFor(2)).resolves.toBe(9)
    expect(prisma.messagePlan.findFirst.mock.calls[0][0].where).toMatchObject({ producerId: null, isTrial: true })
  })

  it('starts numbers on the plan the owner put the organization on, while the catalog offers it', async () => {
    const { service, prisma } = setup()
    const organization = (plan: object) => ({ createdAt: new Date('2026-11-01T00:00:00Z'), plan })
    prisma.producer.findUnique.mockResolvedValue(
      organization({ id: 5, isActive: true, deletedAt: null, producerId: null }),
    )
    await expect(service.initialPlanIdFor(2)).resolves.toBe(5)
    expect(prisma.messagePlan.findFirst).not.toHaveBeenCalled()

    // A plan the owner switched off or deleted since: back to the automatic one (the trial here).
    prisma.producer.findUnique.mockResolvedValue(
      organization({ id: 5, isActive: false, deletedAt: null, producerId: null }),
    )
    await expect(service.initialPlanIdFor(2)).resolves.toBe(9)
    prisma.producer.findUnique.mockResolvedValue(
      organization({ id: 5, isActive: true, deletedAt: new Date(), producerId: null }),
    )
    await expect(service.initialPlanIdFor(2)).resolves.toBe(9)
  })

  it("reads the catalog of the platform only, never an organization's old plans", async () => {
    const { service, prisma } = setup()
    await service.catalog()
    expect(prisma.messagePlan.findMany.mock.calls[0][0].where).toEqual({ producerId: null, deletedAt: null })
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

const delivered = (messageId: string) => ({
  metaPhoneNumberId: 'PN',
  messageId,
  category: 'service',
  recipient: '5493416000000',
  timestamp: Math.floor(Date.now() / 1000),
  billable: false,
})

describe('monthly usage recording', () => {
  it('uses Argentina local time at the month boundary', () => {
    expect(currentPeriod(new Date('2026-10-01T01:00:00Z'))).toBe('2026-09')
    expect(currentPeriod(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10')
  })

  it("keeps Meta's real cost apart while every message counts for the plan", async () => {
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
    // The number is on the smallest paid plan: Inicial, USD 25.
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 25 } })
  })

  it("pauses the number's assistant at its plan's limit, once, and tells its SuperAdmins and admins", async () => {
    const { service, prisma, mail } = setup({ planId: 1 })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 500 })
    await service.recordMeta(delivered('m-500'))
    // Still billed on its plan: nothing moves it up on its own.
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 25 } })
    expect(prisma.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 4, OR: [{ planPausedAt: null }, { planPausedAt: { lt: expect.any(Date) } }] },
      data: { planPausedAt: expect.any(Date), planPauseConfirmedAt: null },
    })
    const notice = prisma.notification.create.mock.calls[0][0].data
    expect(notice).toMatchObject({
      producerId: 2,
      producerCodeId: 8,
      phoneNumberId: 'PN',
      type: 'plan',
      refId: 4,
      title: 'El asistente del +54 9 341 600-0000 está en pausa',
    })
    expect(notice.body).toContain('pasar a Profesional (1.000 mensajes por mes)')
    expect(notice.body).not.toContain('USD')
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      producerId: 2,
      OR: [{ role: 'SUPERADMIN' }, { role: 'ADMIN', producerCodes: { some: { producerCodeId: 8 } } }],
    })
    expect(mail.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['super@org.com'], subject: 'El asistente del +54 9 341 600-0000 está en pausa' }),
    )

    // A message delivered at the same time finds it already paused: no second notice.
    prisma.phoneNumber.updateMany.mockResolvedValue({ count: 0 })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 501 })
    await service.recordMeta(delivered('m-501'))
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 25 } })
  })

  it('leaves a number already paused this month alone, and pauses again a month later', async () => {
    const { service, prisma } = setup({ planId: 2, planPausedAt: new Date() })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 1001 })
    await service.recordMeta(delivered('m-1001'))
    expect(prisma.usageMonthly.update).toHaveBeenLastCalledWith({ where: { id: 9 }, data: { billedUsd: 50 } })
    expect(prisma.phoneNumber.updateMany).not.toHaveBeenCalled()
    expect(prisma.notification.create).not.toHaveBeenCalled()

    const lastMonth = setup({ planId: 2, planPausedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) })
    lastMonth.prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 1000 })
    await lastMonth.service.recordMeta(delivered('m-1000'))
    expect(lastMonth.prisma.notification.create).toHaveBeenCalledTimes(1)
  })

  it('gives way to the smallest paid plan, silently, once the trial month is over', async () => {
    const { service, prisma } = setup({ planId: 9 })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 3 })
    await service.recordMeta(delivered('m-3'))
    expect(prisma.phoneNumber.updateMany).toHaveBeenCalledWith({ where: { id: 4, planId: 9 }, data: { planId: null } })
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('never moves a plan for a late status of a past month', async () => {
    const { service, prisma } = setup({ planId: 1 })
    prisma.usageMonthly.upsert.mockResolvedValue({ id: 9, openaiCostUsd: 0, metaMessages: 900 })
    await service.recordMeta({ ...delivered('late'), timestamp: Date.parse('2026-09-15T12:00:00Z') / 1000 })
    expect(prisma.phoneNumber.updateMany).not.toHaveBeenCalled()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('keeps recording usage when billing fails', async () => {
    const { service, prisma } = setup({ planId: 1 })
    prisma.messagePlan.findMany.mockRejectedValue(new Error('db down'))
    await expect(service.recordMeta(delivered('m-x'))).resolves.toEqual({ overBudget: false })
    expect(prisma.usageMonthly.upsert).toHaveBeenCalled()
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

  it('reports each number with its messages, plan and profit against Meta only', async () => {
    const { service, prisma } = setup()
    prisma.usageMonthly.findMany.mockResolvedValue([
      {
        totalCostUsd: 10,
        openaiCostUsd: 2,
        metaCostUsd: 8,
        billedUsd: 50,
        metaMessages: 1430,
        phoneNumber: { id: 4, isActive: true, planId: 2, extraBlocks: 1, extraBlocksPeriod: '2026-10' },
      },
    ])
    const report = await service.getSummary(2, [8], '2026-10')
    expect(report.rows[0]).toMatchObject({
      messages: 1430,
      plan: { name: 'Profesional + 1.000' },
      billedUsd: 100,
      marginUsd: 92,
    })
    expect(report.totals).toMatchObject({ billedUsd: 100, metaCostUsd: 8, openaiCostUsd: 2, marginUsd: 92 })
  })
})

describe('templates on the plan', () => {
  const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService
  const at = (iso: string) => Date.parse(iso) / 1000
  const message = (messageId: string, category: string, iso: string) => ({
    metaPhoneNumberId: 'PN',
    messageId,
    category,
    billable: category !== 'service',
    recipient: '5493416000000',
    timestamp: at(iso),
  })

  it('tells a template from an in-conversation reply by its Meta category', () => {
    for (const reply of ['service', 'referral_conversion', 'SERVICE']) expect(isTemplateCategory(reply)).toBe(false)
    for (const template of ['utility', 'marketing', 'marketing_lite', 'authentication'])
      expect(isTemplateCategory(template)).toBe(true)
  })

  it('tells a campaign (marketing) message from every other one', () => {
    for (const campaign of ['marketing', 'MARKETING', 'marketing_lite']) expect(isCampaignCategory(campaign)).toBe(true)
    for (const other of ['service', 'referral_conversion', 'utility', 'authentication'])
      expect(isCampaignCategory(other)).toBe(false)
  })

  it('counts only a campaign twice, from COMMERCIAL_TEMPLATE_WEIGHT_FROM, midnight in Argentina by default', () => {
    const pricing = readCommercialPricing(config({}))
    expect(pricing.campaignWeightFrom.toISOString()).toBe('2026-12-01T03:00:00.000Z')
    expect(campaignExtraMessages(pricing, 'marketing', new Date('2026-12-01T02:59:59Z'))).toBe(0)
    expect(campaignExtraMessages(pricing, 'marketing', new Date('2026-12-01T03:00:00Z'))).toBe(1)
    // Notices (utility), authentication and replies count once, also after the start date.
    for (const once of ['utility', 'authentication', 'service', 'referral_conversion'])
      expect(campaignExtraMessages(pricing, once, new Date('2026-12-15T12:00:00Z'))).toBe(0)
    const earlier = readCommercialPricing(config({ COMMERCIAL_TEMPLATE_WEIGHT_FROM: '2026-11-15' }))
    expect(campaignExtraMessages(earlier, 'marketing', new Date('2026-11-20T12:00:00Z'))).toBe(1)
    expect(campaignExtraMessages(earlier, 'utility', new Date('2026-11-20T12:00:00Z'))).toBe(0)
    expect(() => readCommercialPricing(config({ COMMERCIAL_TEMPLATE_WEIGHT_FROM: 'someday' }))).toThrow()
  })

  it('records the raw template count always and the extra plan message of a campaign from the start date on', async () => {
    const { service, prisma } = setup()
    await service.recordMeta(message('before', 'marketing', '2026-11-20T12:00:00Z'))
    await service.recordMeta(message('campaign', 'marketing', '2026-12-02T12:00:00Z'))
    await service.recordMeta(message('notice', 'utility', '2026-12-02T12:01:00Z'))
    await service.recordMeta(message('code', 'authentication', '2026-12-02T12:02:00Z'))
    await service.recordMeta(message('reply', 'service', '2026-12-02T12:05:00Z'))
    const [before, campaign, notice, code, reply] = prisma.usageMonthly.upsert.mock.calls.map(([args]) => args)
    expect(before.create).toMatchObject({ metaMessages: 1, metaTemplateMessages: 1, templateExtraMessages: 0 })
    expect(before.update).toMatchObject({
      metaTemplateMessages: { increment: 1 },
      templateExtraMessages: { increment: 0 },
    })
    expect(campaign.create).toMatchObject({ metaMessages: 1, metaTemplateMessages: 1, templateExtraMessages: 1 })
    expect(campaign.update).toMatchObject({ templateExtraMessages: { increment: 1 } })
    // A notice or an authentication code is still a template, but it counts once on the plan.
    expect(notice.create).toMatchObject({ metaMessages: 1, metaTemplateMessages: 1, templateExtraMessages: 0 })
    expect(code.create).toMatchObject({ metaMessages: 1, metaTemplateMessages: 1, templateExtraMessages: 0 })
    expect(reply.create).toMatchObject({ metaMessages: 1, metaTemplateMessages: 0, templateExtraMessages: 0 })
  })

  it('bills, fills the bar and reaches the limit on the consumed messages', () => {
    const { service } = setup()
    // 380 replies + 60 campaign messages after the start date = 440 sent, 500 consumed.
    const usage = { metaMessages: 440, metaTemplateMessages: 60, templateExtraMessages: 60 }
    expect(consumedMessages(usage)).toBe(500)
    expect(service.billFor({ ...live, planId: 1 }, usage, catalog, '2026-12')).toMatchObject({
      messages: 500,
      plan: { name: 'Inicial', includedMessages: 500 },
      limitReached: true,
      billedUsd: 25,
    })
    // The same month before the start date: every message counts once.
    expect(
      service.billFor({ ...live, planId: 1 }, { metaMessages: 440, metaTemplateMessages: 60 }, catalog, '2026-11'),
    ).toMatchObject({ messages: 440, limitReached: false })
  })

  it('pauses the assistant when a campaign message takes the month to the plan', async () => {
    const { service, prisma } = setup({ planId: 1 }, { COMMERCIAL_TEMPLATE_WEIGHT_FROM: '2026-01-01' })
    // 499 sent, one of them a campaign message counting twice: 500 of Inicial's 500.
    prisma.usageMonthly.upsert.mockResolvedValue({
      id: 9,
      openaiCostUsd: 0,
      metaMessages: 499,
      templateExtraMessages: 1,
    })
    await service.recordMeta({ ...message('t-499', 'marketing', '2026-01-01T12:00:00Z'), timestamp: Date.now() / 1000 })
    expect(prisma.usageMonthly.upsert.mock.calls[0][0].create).toMatchObject({ templateExtraMessages: 1 })
    expect(prisma.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { id: 4, OR: [{ planPausedAt: null }, { planPausedAt: { lt: expect.any(Date) } }] },
      data: { planPausedAt: expect.any(Date), planPauseConfirmedAt: null },
    })
    expect(prisma.notification.create.mock.calls[0][0].data.body).toContain('500 mensajes de su plan Inicial')
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
