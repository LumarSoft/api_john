import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { ScopeService } from '../common/scope/scope.service'
import { UsageService } from '../usage/usage.service'
import { BillingService } from './billing.service'

const plans = [
  { id: 1, name: 'Inicial', tokens: 300, priceUsd: 15, isActive: true, sortOrder: 0, _count: { phoneNumbers: 1 } },
  { id: 2, name: 'Estándar', tokens: 500, priceUsd: 25, isActive: true, sortOrder: 1, _count: { phoneNumbers: 0 } },
  { id: 3, name: 'Profesional', tokens: 1000, priceUsd: 50, isActive: true, sortOrder: 2, _count: { phoneNumbers: 0 } },
]

function setup(numbers: unknown[] = []) {
  const prisma = {
    tokenPlan: {
      findMany: jest.fn().mockResolvedValue(plans),
      findFirst: jest.fn().mockResolvedValue({ id: 2, tokens: 500, priceUsd: 25 }),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...plans[0], ...data, id: 9, _count: { phoneNumbers: 0 } }),
        ),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...plans[0], ...data })),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
    },
    phoneNumber: {
      findMany: jest.fn().mockResolvedValue(numbers),
      findFirst: jest.fn().mockResolvedValue({ id: 8 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    usageMonthly: { groupBy: jest.fn().mockResolvedValue([{ phoneNumberId: 8, _min: { period: '2026-10' } }]) },
    usageEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  const usage = new UsageService(
    prisma as unknown as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
  )
  const scope = { resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue([7]) }
  const service = new BillingService(prisma as unknown as PrismaService, usage, scope as unknown as ScopeService)
  return { service, prisma, scope }
}

const superadmin = { id: 1, producerId: 1, role: Role.SUPERADMIN }
const admin = { id: 2, producerId: 1, role: Role.ADMIN }

describe('BillingService catalog', () => {
  it('prices a new plan by its size at the fixed unit price', async () => {
    const { service, prisma } = setup()

    const plan = await service.createPlan(1, { name: ' Básico ', tokens: 200 })

    expect(prisma.tokenPlan.create.mock.calls[0][0].data).toMatchObject({
      producerId: 1,
      name: 'Básico',
      tokens: 200,
      priceUsd: 10,
      sortOrder: 3,
    })
    expect(plan).toMatchObject({ name: 'Básico', tokens: 200, priceUsd: 10 })
  })

  it('recomputes the price when the size changes and never takes one from the request', async () => {
    const { service, prisma } = setup()

    await service.updatePlan(1, 2, { tokens: 800, name: 'Plus' })

    expect(prisma.tokenPlan.update.mock.calls[0][0].data).toEqual({ name: 'Plus', tokens: 800, priceUsd: 40 })
  })

  it('sells at the price the organization asks, but never below its cost', async () => {
    const { service, prisma } = setup()

    const plan = await service.createPlan(1, { name: 'Inicial', tokens: 500, priceUsd: 30 })
    expect(prisma.tokenPlan.create.mock.calls[0][0].data).toMatchObject({ tokens: 500, priceUsd: 30 })
    expect(plan).toMatchObject({ priceUsd: 30, costUsd: 25, marginUsd: 5 })

    await expect(service.createPlan(1, { name: 'Regalado', tokens: 500, priceUsd: 20 })).rejects.toThrow(
      'no puede ser menor que el costo',
    )
    await expect(service.updatePlan(1, 2, { priceUsd: 24.99 })).rejects.toThrow('no puede ser menor que el costo')
  })

  it('sends the numbers of a retired plan back to the smallest one', async () => {
    const { service, prisma } = setup()

    await service.removePlan(1, 2)

    expect(prisma.phoneNumber.updateMany).toHaveBeenCalledWith({
      where: { tokenPlanId: 2 },
      data: { tokenPlanId: null },
    })
    expect(prisma.tokenPlan.update.mock.calls[0][0].data).toMatchObject({ isActive: false })
    expect(prisma.tokenPlan.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
  })
})

describe('BillingService overview', () => {
  const number = (overrides: Record<string, unknown> = {}) => ({
    id: 8,
    number: '+54 9 341 275-7294',
    isActive: true,
    trialTokens: 0,
    responsibleProducerCode: { id: 7, code: '11425', holderName: null },
    tokenPlan: null,
    usageMonthly: [{ metaMessages: 120, updatedAt: new Date('2026-10-28T18:00:00Z') }],
    ...overrides,
  })

  it('shows each number its plan, how far into it the month is and what it adds up to', async () => {
    const { service } = setup([number()])

    const result = await service.overview(superadmin, '2026-10')

    expect(result).toMatchObject({
      period: '2026-10',
      unitPriceUsd: 0.05,
      totalEstimatedUsd: 15,
      totalCostUsd: 15,
      totalMarginUsd: 0,
    })
    expect(result.plans.map(p => p.name)).toEqual(['Inicial', 'Estándar', 'Profesional'])
    expect(result.numbers[0]).toMatchObject({
      plan: { id: 1, name: 'Inicial', tokens: 300 },
      tokensUsed: 120,
      includedTokens: 300,
      remainingTokens: 180,
      percentUsed: 40,
      exceeded: false,
      billedPlan: { name: 'Inicial', costUsd: 15 },
      estimatedUsd: 15,
      costUsd: 15,
      marginUsd: 0,
    })
  })

  it("keeps the organization's cost away from an admin", async () => {
    const { service } = setup([number()])

    const result = await service.overview(admin, '2026-10')

    expect(result).not.toHaveProperty('totalCostUsd')
    expect(result.numbers[0]).not.toHaveProperty('costUsd')
    expect(result.numbers[0].plan).not.toHaveProperty('costUsd')
    expect(result.numbers[0].billedPlan).not.toHaveProperty('costUsd')
    expect(result.plans[0]).not.toHaveProperty('costUsd')
  })

  it('marks a number past its plan and shows the plan the month moved up to', async () => {
    const { service } = setup([
      number({
        tokenPlan: { id: 1, name: 'Inicial', tokens: 300, priceUsd: 15 },
        usageMonthly: [{ metaMessages: 450, updatedAt: null }],
      }),
    ])

    const [row] = (await service.overview(superadmin, '2026-10')).numbers

    expect(row).toMatchObject({
      includedTokens: 300,
      percentUsed: 150,
      exceeded: true,
      billedPlan: { name: 'Estándar' },
      estimatedUsd: 25,
    })
  })

  it('counts the trial of a first month into the bar', async () => {
    const { service } = setup([number({ trialTokens: 100, usageMonthly: [{ metaMessages: 60, updatedAt: null }] })])

    const [row] = (await service.overview(superadmin, '2026-10')).numbers

    expect(row).toMatchObject({
      trialTokens: 100,
      includedTokens: 100,
      billedPlan: { name: 'Prueba', trial: true },
      estimatedUsd: 0,
    })
  })

  it('limits an admin to the numbers billed to their codes', async () => {
    const { service, prisma } = setup([])

    await service.overview(admin, '2026-10')

    expect(prisma.phoneNumber.findMany.mock.calls[0][0].where).toMatchObject({
      producerId: 1,
      responsibleProducerCodeId: { in: [7] },
    })
  })
})

describe('BillingService.setNumberPlan', () => {
  it('moves a number of the scope to an active plan of the organization', async () => {
    const { service, prisma } = setup()

    await expect(service.setNumberPlan(admin, 8, 2)).resolves.toEqual({ id: 8, planId: 2 })

    expect(prisma.tokenPlan.findFirst.mock.calls[0][0].where).toMatchObject({ id: 2, producerId: 1, isActive: true })
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { tokenPlanId: 2 } })
  })

  it('refuses a number outside the scope or a plan that is not offered', async () => {
    const { service, prisma } = setup()
    prisma.phoneNumber.findFirst.mockResolvedValueOnce(null)
    await expect(service.setNumberPlan(admin, 9, 2)).rejects.toBeInstanceOf(NotFoundException)

    prisma.tokenPlan.findFirst.mockResolvedValueOnce(null)
    await expect(service.setNumberPlan(admin, 8, 5)).rejects.toBeInstanceOf(BadRequestException)
  })
})
