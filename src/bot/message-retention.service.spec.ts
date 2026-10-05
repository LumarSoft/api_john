import { ConfigService } from '@nestjs/config'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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

  describe('pruneOldAudios', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'audios-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    function serviceWith(days?: string) {
      const config = {
        get: jest.fn((key: string) => (key === 'AUDIO_RETENTION_DAYS' ? days : undefined)),
      } as unknown as ConfigService
      return new MessageRetentionService({} as never, config)
    }

    it('deletes voice notes older than the retention window and keeps recent ones', async () => {
      const now = new Date('2026-10-05T12:00:00Z')
      await writeFile(join(dir, 'viejo.ogg'), 'x')
      await writeFile(join(dir, 'nuevo.ogg'), 'x')
      const old = new Date('2026-08-30T12:00:00Z')
      await utimes(join(dir, 'viejo.ogg'), old, old)
      await utimes(join(dir, 'nuevo.ogg'), now, now)

      await expect(serviceWith().pruneOldAudios(dir, now)).resolves.toBe(1)
      await expect(readdir(dir)).resolves.toEqual(['nuevo.ogg'])
    })

    it('honours AUDIO_RETENTION_DAYS', async () => {
      const now = new Date('2026-10-05T12:00:00Z')
      await writeFile(join(dir, 'semana.ogg'), 'x')
      const eightDaysAgo = new Date('2026-09-27T12:00:00Z')
      await utimes(join(dir, 'semana.ogg'), eightDaysAgo, eightDaysAgo)

      await expect(serviceWith('7').pruneOldAudios(dir, now)).resolves.toBe(1)
    })

    it('does nothing when no audio was ever stored', async () => {
      await expect(serviceWith().pruneOldAudios(join(dir, 'no-existe'))).resolves.toBe(0)
    })
  })
})
