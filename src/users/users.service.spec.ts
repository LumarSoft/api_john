import type { PrismaService } from '../prisma/prisma.service'
import { UsersService } from './users.service'

describe('UsersService bot profile', () => {
  const createService = (producer: Record<string, unknown> | null) => {
    const prisma = {
      producer: { findFirst: jest.fn().mockResolvedValue(producer), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn() },
    }
    return {
      prisma,
      service: new UsersService(prisma as unknown as PrismaService),
    }
  }

  it('saves the fields sent over the stored profile', async () => {
    const { prisma, service } = createService({
      botProfile: { orgName: 'Seguros Norte', towTruckPhone: '0800-1', transferAlias: 'NORTE.PAGOS' },
    })

    const profile = await service.updateBotProfile(2, { towTruckPhone: ' 0800-222 ', transferAlias: '' })

    expect(profile).toMatchObject({ orgName: 'Seguros Norte', towTruckPhone: '0800-222', transferAlias: null })
    expect(prisma.producer.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { botProfile: expect.objectContaining({ orgName: 'Seguros Norte', towTruckPhone: '0800-222' }) },
    })
  })

  it('answers 404 for an organization that does not exist', async () => {
    await expect(createService(null).service.getBotProfile(9)).rejects.toMatchObject({ status: 404 })
  })

  it('tells the panel which organization the user belongs to, by the name the bot uses', async () => {
    const { prisma, service } = createService(null)
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'admin@norte.test',
      producer: { name: 'SEGUROS NORTE SRL', slug: 'seguros-norte', botProfile: { orgName: 'Seguros Norte' } },
    })
    ;(prisma as unknown as { phoneNumber: unknown }).phoneNumber = {
      findFirst: jest.fn().mockResolvedValue({ id: 8, number: '+54 9 341 000-0000' }),
    }

    await expect(service.getProfile(7)).resolves.toEqual({
      id: 7,
      email: 'admin@norte.test',
      organization: {
        slug: 'seguros-norte',
        name: 'SEGUROS NORTE SRL',
        displayName: 'Seguros Norte',
        shortName: null,
        // The office line, billed to the master code: the panel's default section filter.
        defaultPhoneNumber: { id: 8, number: '+54 9 341 000-0000' },
      },
    })
  })
})

describe('UsersService branch codes', () => {
  function setup(existing: { id: number; deletedAt: Date | null } | null) {
    const prisma = {
      producerCode: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 9, isMaster: false, isActive: true, ...data })),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 3, code: '14831', isMaster: false, ...data })),
      },
    }
    const service = new UsersService(prisma as unknown as PrismaService)
    return { service, prisma }
  }

  it('creates the branch code of the organization, never a master one', async () => {
    const { service, prisma } = setup(null)

    const code = await service.createProducerCode(1, { code: ' 14831 ', holderName: ' Sucursal Pueblo Esther ' })

    expect(prisma.producerCode.create.mock.calls[0][0].data).toEqual({
      code: '14831',
      holderName: 'Sucursal Pueblo Esther',
      producerId: 1,
    })
    expect(code).toMatchObject({ code: '14831', isMaster: false })
  })

  it('brings a retired code back instead of clashing with it, and refuses a live duplicate', async () => {
    const retired = setup({ id: 3, deletedAt: new Date('2026-01-01') })
    await retired.service.createProducerCode(1, { code: '14831' })
    expect(retired.prisma.producerCode.update.mock.calls[0][0].data).toEqual({
      deletedAt: null,
      holderName: null,
      isActive: true,
    })

    const live = setup({ id: 3, deletedAt: null })
    await expect(live.service.createProducerCode(1, { code: '14831' })).rejects.toThrow('ya existe')
  })
})
