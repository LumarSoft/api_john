import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { ScopeService } from '../common/scope/scope.service'
import { UsageService } from '../usage/usage.service'
import { BillingService } from './billing.service'

const plans = [
  { id: 9, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true, sortOrder: 0 },
  { id: 1, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true, sortOrder: 1 },
  { id: 2, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true, sortOrder: 2 },
]

function setup(numbers: unknown[] = []) {
  const prisma = {
    messagePlan: {
      findMany: jest.fn().mockResolvedValue(plans),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...plans[1], ...data, id: 7 })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...plans[1], ...data })),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
      count: jest.fn().mockResolvedValue(1),
    },
    phoneNumber: {
      findMany: jest.fn().mockResolvedValue(numbers),
      findFirst: jest.fn().mockResolvedValue({ id: 8 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    producer: { findMany: jest.fn().mockResolvedValue([]) },
    usageMonthly: { groupBy: jest.fn().mockResolvedValue([{ phoneNumberId: 8, _min: { period: '2026-09' } }]) },
    usageEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  const usage = new UsageService(
    prisma as unknown as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
    { sendAlert: jest.fn() } as never,
  )
  const scope = { resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue([7]) }
  const service = new BillingService(prisma as unknown as PrismaService, usage, scope as unknown as ScopeService)
  return { service, prisma, scope }
}

const superadmin = { id: 1, producerId: 1, role: Role.SUPERADMIN }
const admin = { id: 2, producerId: 1, role: Role.ADMIN }

describe("the owner's catalog", () => {
  it('lists only the platform plans, the ones switched off included', async () => {
    const { service, prisma } = setup()
    const result = await service.listPlans()
    expect(prisma.messagePlan.findMany.mock.calls[0][0].where).toEqual({ producerId: null, deletedAt: null })
    expect(result).toMatchObject({ blockMessages: 1000 })
    expect(result.plans.map(p => p.name)).toEqual(['Prueba', 'Inicial', 'Profesional'])
  })

  it('creates a plan at the price the owner sets, 0 included', async () => {
    const { service, prisma } = setup()
    await service.createPlan({ name: ' Básico ', messages: 200, priceUsd: 0 })
    expect(prisma.messagePlan.create.mock.calls[0][0].data).toEqual({
      name: 'Básico',
      messages: 200,
      priceUsd: 0,
      isTrial: false,
      sortOrder: 3,
    })
  })

  it('keeps the trial free and allows only one active trial', async () => {
    const { service, prisma } = setup()
    await expect(service.createPlan({ name: 'Prueba', messages: 100, priceUsd: 5, isTrial: true })).rejects.toThrow(
      BadRequestException,
    )
    prisma.messagePlan.findFirst.mockResolvedValueOnce({ name: 'Prueba' })
    await expect(service.createPlan({ name: 'Otra', messages: 50, priceUsd: 0, isTrial: true })).rejects.toThrow(
      ConflictException,
    )
  })

  it('never lets the last active paid plan go', async () => {
    const { service, prisma } = setup()
    prisma.messagePlan.findFirst.mockResolvedValue({ id: 1, priceUsd: 25, isTrial: false, isActive: true })
    prisma.messagePlan.count.mockResolvedValue(0)
    await expect(service.updatePlan(1, { isActive: false })).rejects.toThrow('al menos un plan pago')
    await expect(service.removePlan(1)).rejects.toThrow('al menos un plan pago')
  })

  it('retires a plan and sends its numbers back to the smallest paid plan', async () => {
    const { service, prisma } = setup()
    prisma.messagePlan.findFirst.mockResolvedValue({ id: 2, priceUsd: 50, isTrial: false, isActive: true })
    await service.removePlan(2)
    expect(prisma.phoneNumber.updateMany).toHaveBeenCalledWith({ where: { planId: 2 }, data: { planId: null } })
    expect(prisma.messagePlan.update.mock.calls[0][0]).toMatchObject({
      where: { id: 2 },
      data: { isActive: false },
    })
  })

  it('refuses a plan of an organization (the old per-organization catalog)', async () => {
    const { service } = setup()
    await expect(service.updatePlan(55, { priceUsd: 10 })).rejects.toThrow(NotFoundException)
  })

  it('shows the landing the active plans and the price of a block past the largest', async () => {
    const { service } = setup()
    await expect(service.publicPlans()).resolves.toEqual({
      blockMessages: 1000,
      blockPriceUsd: 50,
      plans: [
        { name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true },
        { name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false },
        { name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false },
      ],
    })
  })
})

describe("the SuperAdmin's plan for each number", () => {
  it('puts a number of the organization on a paid plan', async () => {
    const { service, prisma } = setup()
    prisma.messagePlan.findFirst.mockResolvedValue({ id: 2, isTrial: false })
    await service.assignPlan(superadmin, 8, 2)
    expect(prisma.phoneNumber.findFirst.mock.calls[0][0].where).toMatchObject({ id: 8, producerId: 1 })
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { planId: 2, planUpgradedAt: null },
    })
  })

  it('never assigns the trial, nor a plan or number that is not there', async () => {
    const { service, prisma } = setup()
    prisma.messagePlan.findFirst.mockResolvedValue({ id: 9, isTrial: true })
    await expect(service.assignPlan(superadmin, 8, 9)).rejects.toThrow(BadRequestException)
    prisma.messagePlan.findFirst.mockResolvedValue(null)
    await expect(service.assignPlan(superadmin, 8, 99)).rejects.toThrow(NotFoundException)
    prisma.phoneNumber.findFirst.mockResolvedValue(null)
    await expect(service.assignPlan(superadmin, 404, 2)).rejects.toThrow(NotFoundException)
    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
  })
})

describe('the month of each number', () => {
  const number = (overrides: Record<string, unknown> = {}) => ({
    id: 8,
    number: '+54 9 341 275-7294',
    isActive: true,
    planId: 1,
    planUpgradedAt: null,
    responsibleProducerCode: { id: 7, code: '11425', holderName: null },
    usageMonthly: [{ metaMessages: 120, updatedAt: new Date('2026-10-28T18:00:00Z') }],
    ...overrides,
  })

  it('shows the plan, how far into it the month is and where it goes next', async () => {
    const { service } = setup([number()])
    const result = await service.overview(superadmin, '2026-10')
    expect(result).toMatchObject({ period: '2026-10', blockMessages: 1000, totalBilledUsd: 25 })
    expect(result.plans.map(p => p.name)).toEqual(['Prueba', 'Inicial', 'Profesional'])
    expect(result.numbers[0]).toMatchObject({
      assignedPlan: { id: 1, name: 'Inicial' },
      plan: { id: 1, name: 'Inicial', includedMessages: 500 },
      upgraded: false,
      messagesUsed: 120,
      includedMessages: 500,
      remainingMessages: 380,
      percentUsed: 24,
      nextPlan: { name: 'Profesional', messages: 1000, priceUsd: 50 },
      billedUsd: 25,
    })
  })

  it("repeats the month under the old token names for front_John's panel", async () => {
    const { service } = setup([number()])
    const result = await service.overview(superadmin, '2026-10')
    expect(result).toMatchObject({ unitPriceUsd: 0.05, blockTokens: 1000, trialTokens: 100 })
    expect(result.plans.find(p => p.name === 'Inicial')).toMatchObject({ messages: 500, tokens: 500 })
    expect(result.numbers[0]).toMatchObject({
      plan: { includedMessages: 500, includedTokens: 500, blocks: 1 },
      tokensUsed: 120,
      includedTokens: 500,
      remainingTokens: 380,
      trialTokens: 0,
      nextPlan: { messages: 1000, tokens: 1000 },
    })
  })

  it('shows a busier number on the plan that covers it, and past the largest by blocks', async () => {
    const { service, prisma } = setup([
      number({ usageMonthly: [{ metaMessages: 900, updatedAt: null }] }),
      number({ id: 9, planId: 2, usageMonthly: [{ metaMessages: 1200, updatedAt: null }] }),
    ])
    prisma.usageMonthly.groupBy.mockResolvedValue([
      { phoneNumberId: 8, _min: { period: '2026-09' } },
      { phoneNumberId: 9, _min: { period: '2026-09' } },
    ])
    const [moved, beyond] = (await service.overview(superadmin, '2026-10')).numbers
    expect(moved).toMatchObject({ plan: { name: 'Profesional' }, upgraded: true, percentUsed: 90 })
    expect(beyond).toMatchObject({
      plan: { name: 'Profesional + 1.000', includedMessages: 2000 },
      billedUsd: 100,
      nextPlan: { name: 'Profesional + 2.000', messages: 3000, priceUsd: 150 },
    })
  })

  it('still shows a number that moved up on its own this month as moved up', async () => {
    const { service } = setup([
      number({
        planId: 2,
        planUpgradedAt: new Date('2026-10-12T15:00:00Z'),
        usageMonthly: [{ metaMessages: 640, updatedAt: null }],
      }),
    ])
    const [row] = (await service.overview(superadmin, '2026-10')).numbers
    expect(row).toMatchObject({ plan: { name: 'Profesional' }, upgraded: true, movedUpAt: '2026-10-12T15:00:00.000Z' })
    const [before] = (await service.overview(superadmin, '2026-09')).numbers
    expect(before).toMatchObject({ upgraded: false, movedUpAt: null })
  })

  it('limits an admin to the numbers billed to their codes and keeps the total to the SuperAdmin', async () => {
    const { service, prisma } = setup([number()])
    const result = await service.overview(admin, '2026-10')
    expect(prisma.phoneNumber.findMany.mock.calls[0][0].where).toMatchObject({
      producerId: 1,
      responsibleProducerCodeId: { in: [7] },
    })
    expect(result).not.toHaveProperty('totalBilledUsd')
  })

  it('rejects invalid and future months', async () => {
    const { service } = setup()
    await expect(service.overview(superadmin, '2026-13')).rejects.toThrow(BadRequestException)
    await expect(service.overview(superadmin, '2999-01')).rejects.toThrow(BadRequestException)
  })
})

describe("front_John's panel, until it redirects to Polisend", () => {
  it('reads the active catalog under the old names', async () => {
    const { service } = setup()
    const result = await service.legacyCatalog()
    expect(result.unitPriceUsd).toBe(0.05)
    expect(result.plans).toEqual([
      { id: 9, name: 'Prueba', tokens: 100, priceUsd: 0, costUsd: 0, isActive: true, sortOrder: 0 },
      { id: 1, name: 'Inicial', tokens: 500, priceUsd: 25, costUsd: 25, isActive: true, sortOrder: 1 },
      { id: 2, name: 'Profesional', tokens: 1000, priceUsd: 50, costUsd: 50, isActive: true, sortOrder: 2 },
    ])
  })
})

describe("the owner's dashboard", () => {
  it('adds up what each organization is billed against what Meta really charges, OpenAI apart', async () => {
    const { service, prisma } = setup()
    prisma.producer.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'JPMG',
        isActive: true,
        phoneNumbers: [
          {
            id: 8,
            number: '+54 9 341 275-7294',
            isActive: true,
            planId: 1,
            responsibleProducerCode: { code: '11425', holderName: null },
            // Under the 1,000 free service messages: Meta charges nothing.
            usageMonthly: [{ metaMessages: 420, metaBillableMessages: 0, metaCostUsd: 0, openaiCostUsd: 1.2 }],
          },
          {
            id: 9,
            number: '+54 9 341 000-0000',
            isActive: true,
            planId: 1,
            responsibleProducerCode: null,
            // 1,350 messages: billed as Profesional + 1.000, Meta charges the 350 past the free ones.
            usageMonthly: [{ metaMessages: 1350, metaBillableMessages: 350, metaCostUsd: 9.1, openaiCostUsd: 2 }],
          },
        ],
      },
    ])
    prisma.usageMonthly.groupBy.mockResolvedValue([
      { phoneNumberId: 8, _min: { period: '2026-09' } },
      { phoneNumberId: 9, _min: { period: '2026-09' } },
    ])
    const result = await service.ownerDashboard('2026-10')
    expect(result.organizations[0].numbers[0]).toMatchObject({ billedUsd: 25, metaCostUsd: 0, profitUsd: 25 })
    expect(result.organizations[0].numbers[1]).toMatchObject({
      plan: { name: 'Profesional + 1.000' },
      upgraded: true,
      billedUsd: 100,
      metaCostUsd: 9.1,
      profitUsd: 90.9,
    })
    expect(result.totals).toMatchObject({
      organizations: 1,
      activeNumbers: 2,
      upgradedNumbers: 1,
      messages: 1770,
      billedUsd: 125,
      metaCostUsd: 9.1,
      openaiCostUsd: 3.2,
      profitUsd: 115.9,
    })
  })
})
