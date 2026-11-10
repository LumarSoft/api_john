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
