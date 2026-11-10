import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { UsageService } from '../usage/usage.service'
import { OwnerService } from './owner.service'

describe('OwnerService addUser', () => {
  const createService = ({ codesOfOrg = 0 } = {}) => {
    const prisma = {
      producer: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      producerCode: { count: jest.fn().mockResolvedValue(codesOfOrg) },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: { email: string; role: Role } }) =>
          Promise.resolve({
            id: 9,
            email: data.email,
            role: data.role,
            createdAt: new Date('2026-11-09T12:00:00Z'),
            producerCodes: [
              { producerCode: { id: 31, code: '8074', holderName: 'Ana' } },
              { producerCode: { id: 32, code: '14831', holderName: null } },
            ],
          }),
        ),
      },
    }
    return {
      prisma,
      service: new OwnerService(prisma as unknown as PrismaService, {} as UsageService),
    }
  }

  it('grants an admin the codes sent with it, in the same write that creates it', async () => {
    const { prisma, service } = createService({ codesOfOrg: 2 })

    const user = await service.addUser(2, {
      email: 'ana@norte.test',
      password: 'secret1',
      role: Role.ADMIN,
      producerCodeIds: [31, 32],
    })

    expect(prisma.producerCode.count).toHaveBeenCalledWith({
      where: { id: { in: [31, 32] }, producerId: 2, deletedAt: null },
    })
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          producerId: 2,
          role: Role.ADMIN,
          producerCodes: { create: [{ producerCodeId: 31 }, { producerCodeId: 32 }] },
        }),
      }),
    )
    expect(user.codes).toEqual([
      { id: 31, code: '8074', holderName: 'Ana' },
      { id: 32, code: '14831', holderName: null },
    ])
    expect(user).not.toHaveProperty('password')
  })

  it('refuses a code of another organization and creates nobody', async () => {
    const { prisma, service } = createService({ codesOfOrg: 1 })

    await expect(
      service.addUser(2, { email: 'ana@norte.test', password: 'secret1', role: Role.ADMIN, producerCodeIds: [31, 77] }),
    ).rejects.toMatchObject({ status: 400 })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('gives a superadmin no grants: it sees every code of its organization', async () => {
    const { prisma, service } = createService()

    const user = await service.addUser(2, {
      email: 'jefe@norte.test',
      password: 'secret1',
      role: Role.SUPERADMIN,
      producerCodeIds: [31],
    })

    expect(prisma.producerCode.count).not.toHaveBeenCalled()
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ producerCodes: { create: [] } }) }),
    )
    expect(user.codes).toEqual([])
  })

  it('still creates an admin without codes', async () => {
    const { prisma, service } = createService()

    await service.addUser(2, { email: 'ana@norte.test', password: 'secret1', role: Role.ADMIN })

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ producerCodes: { create: [] } }) }),
    )
  })
})

describe('OwnerService setOrganizationPlan', () => {
  const CATALOG = [
    { id: 3, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true },
    { id: 4, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true },
    { id: 5, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true },
    { id: 7, name: 'Viejo', messages: 800, priceUsd: 40, isTrial: false, isActive: false },
  ]

  const createService = ({ exists = true } = {}) => {
    let planId: number | null = null
    const prisma = {
      producer: {
        findFirst: jest.fn().mockResolvedValue(exists ? { id: 3 } : null),
        update: jest.fn().mockImplementation(({ data }: { data: { planId: number | null } }) => {
          planId = data.planId
          return Promise.resolve({ id: 3 })
        }),
      },
    }
    const usage = {
      catalog: jest.fn().mockResolvedValue(CATALOG),
      // The organization's plan, else the trial (a new account).
      initialPlanIdFor: jest.fn().mockImplementation(() => Promise.resolve(planId ?? 3)),
      assignedPlanFor: jest.fn((id: number | null) => {
        const plan = CATALOG.find(p => p.id === id)
        return plan ? { id: plan.id, name: plan.name, trial: plan.isTrial } : null
      }),
    }
    return {
      prisma,
      service: new OwnerService(prisma as unknown as PrismaService, usage as unknown as UsageService),
    }
  }

  it('puts an organization with no number on a plan of the catalog', async () => {
    const { prisma, service } = createService()

    await expect(service.setOrganizationPlan(3, 5)).resolves.toEqual({
      id: 3,
      planId: 5,
      startingPlan: { id: 5, name: 'Profesional', trial: false },
    })
    expect(prisma.producer.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { planId: 5 } })
  })

  it('takes the plan off with null: back to the automatic one', async () => {
    const { prisma, service } = createService()

    await expect(service.setOrganizationPlan(3, null)).resolves.toEqual({
      id: 3,
      planId: null,
      startingPlan: { id: 3, name: 'Prueba', trial: true },
    })
    expect(prisma.producer.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { planId: null } })
  })

  it('refuses a plan the catalog does not have or has switched off, and an unknown organization', async () => {
    const { prisma, service } = createService()

    await expect(service.setOrganizationPlan(3, 99)).rejects.toMatchObject({ status: 404 })
    await expect(service.setOrganizationPlan(3, 7)).rejects.toMatchObject({ status: 400 })
    expect(prisma.producer.update).not.toHaveBeenCalled()

    const missing = createService({ exists: false })
    await expect(missing.service.setOrganizationPlan(8, 5)).rejects.toMatchObject({ status: 404 })
  })
})
