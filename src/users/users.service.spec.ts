import type { PrismaService } from '../prisma/prisma.service'
import type { BotStatusAlertService } from './bot-status-alert.service'
import { UsersService } from './users.service'

describe('UsersService producer bot status', () => {
  const createService = () => {
    const prisma = {
      producer: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      botStatusChange: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      // The audit row and the switch are written together.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    }
    const alerts = { notify: jest.fn().mockResolvedValue(undefined) }
    return {
      prisma,
      alerts,
      service: new UsersService(prisma as unknown as PrismaService, alerts as unknown as BotStatusAlertService),
    }
  }

  it('returns the organization-wide bot status with the config and who last changed it', async () => {
    const { prisma, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ botName: 'Nico', botEnabled: false, staffNames: 'Mili, Milagros' })
    prisma.botStatusChange.findFirst.mockResolvedValue({
      botEnabled: false,
      createdAt: new Date('2026-10-06T11:12:00Z'),
      user: { email: 'mili@jpmg.com' },
    })

    await expect(service.getProducerConfig(4)).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
      staffNames: ['Mili', 'Milagros'],
      lastBotStatusChange: { botEnabled: false, at: new Date('2026-10-06T11:12:00Z'), by: 'mili@jpmg.com' },
    })
  })

  it('saves the office names without touching the bot name', async () => {
    const { prisma, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4 })
    prisma.producer.update.mockResolvedValue({ botName: 'Nico', botEnabled: true, staffNames: 'Mili, Milagros' })

    await expect(service.updateProducerConfig(4, { staffNames: [' Mili ', 'Milagros', 'mili', ''] })).resolves.toEqual({
      botName: 'Nico',
      botEnabled: true,
      staffNames: ['Mili', 'Milagros'],
    })
    expect(prisma.producer.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { staffNames: 'Mili, Milagros' },
      select: { botName: true, botEnabled: true, staffNames: true },
    })
  })

  it('clears the office names with an empty list', async () => {
    const { prisma, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4 })
    prisma.producer.update.mockResolvedValue({ botName: null, botEnabled: true, staffNames: null })

    await expect(service.updateProducerConfig(4, { staffNames: [] })).resolves.toMatchObject({ staffNames: [] })
    expect(prisma.producer.update).toHaveBeenCalledWith(expect.objectContaining({ data: { staffNames: null } }))
  })

  it('updates the requesting organization, records who did it and announces it', async () => {
    const { prisma, alerts, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4, name: 'JPMG', botName: 'Nico', botEnabled: true })
    prisma.botStatusChange.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-05T19:00:00Z') })
    prisma.producer.update.mockResolvedValue({ botName: 'Nico', botEnabled: false })
    prisma.botStatusChange.create.mockResolvedValue({ createdAt: new Date('2026-10-06T11:12:00Z') })

    await expect(service.setBotEnabled(4, false, { id: 9, email: 'mili@jpmg.com' })).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
    })
    expect(prisma.producer.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { botEnabled: false },
      select: { botName: true, botEnabled: true },
    })
    expect(prisma.botStatusChange.create).toHaveBeenCalledWith({
      data: { producerId: 4, botEnabled: false, userId: 9 },
      select: { createdAt: true },
    })
    expect(alerts.notify).toHaveBeenCalledWith({
      producerId: 4,
      producerName: 'JPMG',
      botEnabled: false,
      actorEmail: 'mili@jpmg.com',
      at: new Date('2026-10-06T11:12:00Z'),
      since: new Date('2026-10-05T19:00:00Z'),
    })
  })

  it('ignores a request that does not change the state (no audit row, no alert)', async () => {
    const { prisma, alerts, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4, name: 'JPMG', botName: 'Nico', botEnabled: false })

    await expect(service.setBotEnabled(4, false, { id: 9, email: 'mili@jpmg.com' })).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
    })
    expect(prisma.producer.update).not.toHaveBeenCalled()
    expect(prisma.botStatusChange.create).not.toHaveBeenCalled()
    expect(alerts.notify).not.toHaveBeenCalled()
  })

  it('still flips the switch when the announcement fails', async () => {
    const { prisma, alerts, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4, name: 'JPMG', botName: 'Nico', botEnabled: false })
    prisma.producer.update.mockResolvedValue({ botName: 'Nico', botEnabled: true })
    prisma.botStatusChange.create.mockResolvedValue({ createdAt: new Date() })
    alerts.notify.mockRejectedValue(new Error('smtp down'))

    await expect(service.setBotEnabled(4, true, { id: 9, email: 'mili@jpmg.com' })).resolves.toEqual({
      botName: 'Nico',
      botEnabled: true,
    })
  })
})

describe('UsersService bot profile', () => {
  const createService = (producer: Record<string, unknown> | null) => {
    const prisma = {
      producer: { findFirst: jest.fn().mockResolvedValue(producer), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn() },
    }
    const alerts = { notify: jest.fn() }
    return {
      prisma,
      service: new UsersService(prisma as unknown as PrismaService, alerts as unknown as BotStatusAlertService),
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
