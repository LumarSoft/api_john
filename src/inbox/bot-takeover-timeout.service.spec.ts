import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { InboxService } from './inbox.service'
import { BotTakeoverTimeoutService } from './bot-takeover-timeout.service'

describe('BotTakeoverTimeoutService', () => {
  const now = new Date('2026-09-30T15:00:00Z')
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

  function setup(conversation: { handedOverAt: Date | null }, lastReplyAt: Date | null, timeout?: string) {
    const prisma = {
      conversation: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, waId: '549341', phoneNumberId: 'P1', ...conversation }]),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue(lastReplyAt ? { createdAt: lastReplyAt } : null),
      },
    }
    const inbox = { autoReleaseToBot: jest.fn().mockResolvedValue(true) }
    const config = { get: jest.fn().mockReturnValue(timeout) }
    const service = new BotTakeoverTimeoutService(
      prisma as unknown as PrismaService,
      inbox as unknown as InboxService,
      config as unknown as ConfigService,
    )
    return { service, prisma, inbox }
  }

  it('returns the conversation to the bot after 30 min without an operator reply', async () => {
    const { service, inbox } = setup({ handedOverAt: minutesAgo(90) }, minutesAgo(31))

    await expect(service.releaseIdleTakeovers(now)).resolves.toBe(1)
    expect(inbox.autoReleaseToBot).toHaveBeenCalledWith(expect.objectContaining({ id: 7, phoneNumberId: 'P1' }))
  })

  it('keeps it paused while the operator answered recently', async () => {
    const { service, inbox } = setup({ handedOverAt: minutesAgo(90) }, minutesAgo(10))

    await expect(service.releaseIdleTakeovers(now)).resolves.toBe(0)
    expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
  })

  it('counts the takeover itself as activity (operator has not written yet)', async () => {
    const { service, inbox } = setup({ handedOverAt: minutesAgo(5) }, null)

    await service.releaseIdleTakeovers(now)

    expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
  })

  it('only looks at operator replies (inbox or WhatsApp Business app), not customer messages', async () => {
    const { service, prisma } = setup({ handedOverAt: minutesAgo(90) }, minutesAgo(31))

    await service.releaseIdleTakeovers(now)

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ role: 'agent' }, { source: 'app_echo' }] }),
      }),
    )
  })

  it('releases a legacy pause that has no timestamps at all', async () => {
    const { service, inbox } = setup({ handedOverAt: null }, null)

    await service.releaseIdleTakeovers(now)

    expect(inbox.autoReleaseToBot).toHaveBeenCalled()
  })

  it('honours BOT_TAKEOVER_TIMEOUT_MINUTES', async () => {
    const { service, inbox } = setup({ handedOverAt: minutesAgo(90) }, minutesAgo(31), '60')

    await service.releaseIdleTakeovers(now)

    expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
  })
})
