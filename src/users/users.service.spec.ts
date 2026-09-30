import type { PrismaService } from '../prisma/prisma.service'
import { UsersService } from './users.service'

describe('UsersService producer bot status', () => {
  const createService = () => {
    const prisma = {
      producer: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    }
    return {
      prisma,
      service: new UsersService(prisma as unknown as PrismaService),
    }
  }

  it('returns the organization-wide bot status with the config', async () => {
    const { prisma, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({
      botName: 'Nico',
      botEnabled: false,
    })

    await expect(service.getProducerConfig(4)).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
    })
  })

  it('updates only the requesting organization bot status', async () => {
    const { prisma, service } = createService()
    prisma.producer.findFirst.mockResolvedValue({ id: 4 })
    prisma.producer.update.mockResolvedValue({
      botName: 'Nico',
      botEnabled: false,
    })

    await expect(service.setBotEnabled(4, false)).resolves.toEqual({
      botName: 'Nico',
      botEnabled: false,
    })
    expect(prisma.producer.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { botEnabled: false },
      select: { botName: true, botEnabled: true },
    })
  })
})
