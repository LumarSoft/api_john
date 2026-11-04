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
  roles = [] as Array<{ feature: string; admin: boolean; superAdmin: boolean }>,
} = {}) {
  const prisma = {
    messagePlan: {
      findMany: jest.fn().mockResolvedValue(CATALOG.map(p => ({ id: p.id, features: features[p.id] ?? null }))),
    },
    phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) },
    planFeatureRole: { findMany: jest.fn().mockResolvedValue(roles), upsert: jest.fn().mockResolvedValue({}) },
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
  it('gives what a plan never set its default: the old notices on, everything added since off', () => {
    expect(featuresOf(null)).toEqual(
      expect.objectContaining({
        rejection_notices: true,
        expiry_notices: true,
        ai_assistant: false,
        campaign_cross_sell: false,
      }),
    )
    const stored = featuresOf({ campaign_cross_sell: true, rejection_notices: false, gone: false })
    expect(stored).toEqual(expect.objectContaining({ rejection_notices: false, campaign_cross_sell: true }))
    expect(stored).not.toHaveProperty('gone')
  })

  it('takes the owner changes and refuses a function that does not exist', () => {
    expect(withChanges({ campaign_cross_sell: true }, { rejection_notices: false })).toEqual(
      expect.objectContaining({ rejection_notices: false, expiry_notices: true, campaign_cross_sell: true }),
    )
    expect(() => withChanges(null, { reports: true })).toThrow(BadRequestException)
    expect(() => withChanges(null, { campaign_cross_sell: 'no' })).toThrow(BadRequestException)
  })

  it('counts a function when one of the plans includes it', () => {
    const on = featuresOf({ campaign_cross_sell: true })
    expect(unionOf([on, featuresOf(null)]).campaign_cross_sell).toBe(true)
    expect(unionOf([featuresOf(null)]).campaign_cross_sell).toBe(false)
  })
})

describe('PlanFeaturesService.forUser', () => {
  it('leaves out what the plan of every active number turns off', async () => {
    const { service } = setup({
      numbers: [{ id: 11, planId: 4 }],
      features: { 4: { rejection_notices: false }, 6: { campaign_cross_sell: true } },
    })

    const result = await service.forUser(admin)

    expect(result.features).toEqual(
      expect.objectContaining({ rejection_notices: false, expiry_notices: true, campaign_cross_sell: false }),
    )
    // The cheapest paid plan that includes each function, for "disponible en el plan X".
    expect(result.availableIn).toEqual(
      expect.objectContaining({
        rejection_notices: 'Profesional',
        expiry_notices: 'Inicial',
        campaign_cross_sell: 'Empresa',
      }),
    )
  })

  it('gives the organization what any of its numbers has', async () => {
    const { service } = setup({
      numbers: [
        { id: 11, planId: 4 },
        { id: 12, planId: 6 },
      ],
      features: { 6: { campaign_cross_sell: true } },
    })

    expect((await service.forUser(admin)).features.campaign_cross_sell).toBe(true)
  })

  it('reads the trial only in the number’s first month, and the smallest paid plan after it', async () => {
    // Inicial never set it: the campaign's default, off.
    const features = { 3: { campaign_cross_sell: true } }
    const firstMonth = setup({ numbers: [{ id: 11, planId: 3 }], features })
    const later = setup({ numbers: [{ id: 11, planId: 3 }], features, starts: new Map([[11, new Date('2026-09-10')]]) })

    expect((await firstMonth.service.forUser(admin)).features.campaign_cross_sell).toBe(true)
    expect((await later.service.forUser(admin)).features.campaign_cross_sell).toBe(false)
  })

  it('uses the plan the first number will start on when there is no number yet', async () => {
    const { service, usage } = setup({ initialPlanId: 3, features: { 3: { expiry_notices: false } } })

    expect((await service.forUser(admin)).features.expiry_notices).toBe(false)
    expect(usage.initialPlanIdFor).toHaveBeenCalledWith(7)
  })

  it('gives the owner every function', async () => {
    const { service, prisma } = setup({
      numbers: [{ id: 11, planId: 4 }],
      features: { 4: { campaign_cross_sell: false } },
    })

    expect((await service.forUser({ id: 1, producerId: 1, role: Role.OWNER })).features.campaign_cross_sell).toBe(true)
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

describe('plan functions by role', () => {
  const superAdmin = { id: 3, producerId: 7, role: Role.SUPERADMIN }

  it('takes off what the user’s role has off, and says it was the role', async () => {
    const { service } = setup({
      numbers: [{ id: 11, planId: 6 }],
      features: { 6: { ai_assistant: true, campaign_renewal: true } },
      roles: [{ feature: 'ai_assistant', admin: false, superAdmin: true }],
    })

    const forAdmin = await service.forUser(admin)
    expect(forAdmin.features.ai_assistant).toBe(false)
    expect(forAdmin.blockedByRole).toEqual(['ai_assistant'])
    expect(forAdmin.features.campaign_renewal).toBe(true)

    const forSuperAdmin = await service.forUser(superAdmin)
    expect(forSuperAdmin.features.ai_assistant).toBe(true)
    expect(forSuperAdmin.blockedByRole).toEqual([])
  })

  it('answers 403 to a role that has the function off, never to the owner', async () => {
    const { service } = setup({ roles: [{ feature: 'rejection_notices', admin: false, superAdmin: true }] })

    await expect(service.assertRole(admin, 'rejection_notices')).rejects.toThrow(ForbiddenException)
    await expect(service.assertRole(superAdmin, 'rejection_notices')).resolves.toBeUndefined()
    await expect(
      service.assertRole({ id: 1, producerId: 1, role: Role.OWNER }, 'rejection_notices'),
    ).resolves.toBeUndefined()
  })

  it('keeps both roles on until the owner changes one', async () => {
    const { service, prisma } = setup()

    expect((await service.roles()).campaign_winback).toEqual({ ADMIN: true, SUPERADMIN: true })
    await expect(service.setRoles('campaign_winback', { ADMIN: false })).resolves.toEqual({
      ADMIN: false,
      SUPERADMIN: true,
    })
    expect(prisma.planFeatureRole.upsert).toHaveBeenCalledWith({
      where: { feature: 'campaign_winback' },
      create: { feature: 'campaign_winback', admin: false, superAdmin: true },
      update: { admin: false, superAdmin: true, deletedAt: null },
    })
  })
})
