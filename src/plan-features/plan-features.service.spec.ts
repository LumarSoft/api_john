import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { CatalogPlan, UsageService } from '../usage/usage.service'
import { featuresOf, unionOf, withChanges } from './plan-features'
import { PlanFeaturesService } from './plan-features.service'

const plan = (id: number, name: string, messages: number, priceUsd: number, isTrial = false): CatalogPlan => ({
  id,
  name,
  messages,
  priceUsd,
  isTrial,
  isActive: true,
})

// The production catalog of 2026-11-03, smallest first as usage.catalog() returns it.
const CATALOG = [
  plan(3, 'Prueba', 100, 0, true),
  plan(4, 'Inicial', 500, 25),
  plan(5, 'Profesional', 1000, 50),
  plan(6, 'Empresa', 2000, 100),
]

function setup({
  numbers = [] as Array<{ id: number; planId: number | null }>,
  features = {} as Record<number, unknown>,
  starts = new Map<number, Date>(),
  initialPlanId = null as number | null,
} = {}) {
  const prisma = {
    messagePlan: {
      findMany: jest.fn().mockResolvedValue(CATALOG.map(p => ({ id: p.id, features: features[p.id] ?? null }))),
    },
    phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) },
  }
  const usage = {
    catalog: jest.fn().mockResolvedValue(CATALOG),
    serviceStarts: jest.fn().mockResolvedValue(starts),
    initialPlanIdFor: jest.fn().mockResolvedValue(initialPlanId),
    // Same rule as UsageService.assignedPlanFor: the trial only in the first month, else the smallest paid plan.
    assignedPlanFor: jest.fn((planId: number | null, catalog: CatalogPlan[], firstMonth: boolean) => {
      const assigned = catalog.find(p => p.id === planId)
      const valid = assigned && (!assigned.isTrial || firstMonth) ? assigned : catalog.find(p => !p.isTrial)
      return valid ? { id: valid.id } : null
    }),
  }
  const service = new PlanFeaturesService(prisma as unknown as PrismaService, usage as unknown as UsageService)
  return { service, prisma, usage }
}

const admin = { id: 2, producerId: 7, role: Role.ADMIN }

describe('plan features', () => {
  it('includes every function a plan does not turn off', () => {
    expect(Object.values(featuresOf(null)).every(Boolean)).toBe(true)
    const stored = featuresOf({ internal_chat: false, gone: false })
    expect(stored).toEqual(
      expect.objectContaining({ rejection_notices: true, expiry_notices: true, internal_chat: false }),
    )
    expect(stored).not.toHaveProperty('gone')
  })

  it('takes the owner changes and refuses a function that does not exist', () => {
    expect(withChanges({ internal_chat: false }, { rejection_notices: false })).toEqual(
      expect.objectContaining({ rejection_notices: false, expiry_notices: true, internal_chat: false }),
    )
    expect(() => withChanges(null, { reports: true })).toThrow(BadRequestException)
    expect(() => withChanges(null, { internal_chat: 'no' })).toThrow(BadRequestException)
  })

  it('counts a function when one of the plans includes it', () => {
    const off = featuresOf({ internal_chat: false })
    expect(unionOf([off, featuresOf(null)]).internal_chat).toBe(true)
    expect(unionOf([off]).internal_chat).toBe(false)
  })
})

describe('PlanFeaturesService.forUser', () => {
  it('leaves out what the plan of every active number turns off', async () => {
    const { service } = setup({
      numbers: [{ id: 11, planId: 4 }],
      features: { 4: { rejection_notices: false, internal_chat: false }, 5: { internal_chat: false } },
    })

    const result = await service.forUser(admin)

    expect(result.features).toEqual(
      expect.objectContaining({ rejection_notices: false, expiry_notices: true, internal_chat: false }),
    )
    // The cheapest paid plan that includes each function, for "disponible en el plan X".
    expect(result.availableIn).toEqual(
      expect.objectContaining({
        rejection_notices: 'Profesional',
        expiry_notices: 'Inicial',
        internal_chat: 'Empresa',
      }),
    )
  })

  it('gives the organization what any of its numbers has', async () => {
    const { service } = setup({
      numbers: [
        { id: 11, planId: 4 },
        { id: 12, planId: 6 },
      ],
      features: { 4: { internal_chat: false } },
    })

    expect((await service.forUser(admin)).features.internal_chat).toBe(true)
  })

  it('reads the trial only in the number’s first month, and the smallest paid plan after it', async () => {
    const features = { 3: { internal_chat: true }, 4: { internal_chat: false } }
    const firstMonth = setup({ numbers: [{ id: 11, planId: 3 }], features })
    const later = setup({ numbers: [{ id: 11, planId: 3 }], features, starts: new Map([[11, new Date('2026-09-10')]]) })

    expect((await firstMonth.service.forUser(admin)).features.internal_chat).toBe(true)
    expect((await later.service.forUser(admin)).features.internal_chat).toBe(false)
  })

  it('uses the plan the first number will start on when there is no number yet', async () => {
    const { service, usage } = setup({ initialPlanId: 3, features: { 3: { expiry_notices: false } } })

    expect((await service.forUser(admin)).features.expiry_notices).toBe(false)
    expect(usage.initialPlanIdFor).toHaveBeenCalledWith(7)
  })

  it('gives the owner every function', async () => {
    const { service, prisma } = setup({ numbers: [{ id: 11, planId: 4 }], features: { 4: { internal_chat: false } } })

    expect((await service.forUser({ id: 1, producerId: 1, role: Role.OWNER })).features.internal_chat).toBe(true)
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })
})

describe('PlanFeaturesService.keepWith', () => {
  it('keeps the numbers whose plan includes the function', async () => {
    const { service } = setup({ features: { 4: { rejection_notices: false } } })
    const numbers = [
      { id: 11, planId: 4, phoneNumberId: 'inicial' },
      { id: 12, planId: 6, phoneNumberId: 'empresa' },
    ]

    expect(await service.keepWith(numbers, 'rejection_notices')).toEqual([numbers[1]])
  })

  it('answers 403 when no number has it', async () => {
    const { service } = setup({ features: { 4: { rejection_notices: false } } })

    await expect(service.keepWith([{ id: 11, planId: 4 }], 'rejection_notices')).rejects.toThrow(ForbiddenException)
    await expect(service.keepWith([], 'rejection_notices')).resolves.toEqual([])
  })
})
