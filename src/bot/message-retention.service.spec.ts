import { ConfigService } from '@nestjs/config'
import { MessageRetentionService } from './message-retention.service'

describe('MessageRetentionService', () => {
  it('keeps imported history for 180 days while pruning normal messages after 30', async () => {
    const prisma = {
      message: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    }
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'MESSAGE_RETENTION_DAYS') return '30'
        if (key === 'COEXISTENCE_HISTORY_RETENTION_DAYS') return '180'
        return undefined
      }),
    } as unknown as ConfigService
    const service = new MessageRetentionService(prisma as any, config)

    await service.pruneOldMessages()

    expect(prisma.message.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { source: { not: 'history' }, createdAt: { lt: expect.any(Date) } },
          { source: 'history', createdAt: { lt: expect.any(Date) } },
        ],
      },
    })
    const where = prisma.message.deleteMany.mock.calls[0][0].where
    const liveCutoff = where.OR[0].createdAt.lt as Date
    const historyCutoff = where.OR[1].createdAt.lt as Date
    const gapDays = Math.round((liveCutoff.getTime() - historyCutoff.getTime()) / (24 * 60 * 60 * 1000))
    expect(gapDays).toBe(150)
  })
})
