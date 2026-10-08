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
    prisma.producer.findFirst.mockResolvedValue({ botName: 'Nico', botEnabled: false })
    prisma.botStatusChange.findFirst.mockResolvedValue({
      botEnabled: false,
      createdAt: new Date('2026-10-06T11:12:00Z'),
      user: { email: 'mili@jpmg.com' },
    })

    await expect(service.getProducerConfig(4)).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
      lastBotStatusChange: { botEnabled: false, at: new Date('2026-10-06T11:12:00Z'), by: 'mili@jpmg.com' },
    })
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
