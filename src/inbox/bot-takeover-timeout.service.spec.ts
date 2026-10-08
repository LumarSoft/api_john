import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { InboxService } from './inbox.service'
import { BotTakeoverTimeoutService } from './bot-takeover-timeout.service'

describe('BotTakeoverTimeoutService', () => {
  // Wednesday 12:00 in Buenos Aires: inside the default 8–16 business hours.
  const openNow = new Date('2026-09-30T15:00:00Z')
  // Same day 20:00 in Buenos Aires: office closed.
  const closedNow = new Date('2026-09-30T23:00:00Z')
  const minutesBefore = (now: Date, m: number) => new Date(now.getTime() - m * 60_000)

  function setup(
    conversation: { handedOverAt: Date | null },
    lastReplyAt: Date | null,
    lastCustomerAt: Date | null,
    env: Record<string, string> = {},
  ) {
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 7, waId: '549341', phoneNumberId: 'P1', producer: {}, ...conversation }]),
      },
      message: {
        // The sweep asks twice per conversation: operator activity, then customer.
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { role?: string } }) =>
            Promise.resolve(
              where.role === 'user'
                ? lastCustomerAt && { createdAt: lastCustomerAt }
                : lastReplyAt && { createdAt: lastReplyAt },
            ),
          ),
      },
    }
    const inbox = { autoReleaseToBot: jest.fn().mockResolvedValue(true) }
    const config = { get: jest.fn((key: string) => env[key]) }
    const service = new BotTakeoverTimeoutService(
      prisma as unknown as PrismaService,
      inbox as unknown as InboxService,
      config as unknown as ConfigService,
    )
    return { service, prisma, inbox }
  }

  describe('within business hours', () => {
    it('keeps the human on the chat while the customer keeps talking, even past 30 min of operator silence', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(openNow, 90) },
        minutesBefore(openNow, 31),
        minutesBefore(openNow, 3),
      )

      await expect(service.releaseIdleTakeovers(openNow)).resolves.toBe(0)
      expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
    })

    it('keeps it paused while the operator answered recently', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(openNow, 90) },
        minutesBefore(openNow, 10),
        minutesBefore(openNow, 200),
      )

      await expect(service.releaseIdleTakeovers(openNow)).resolves.toBe(0)
      expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
    })

    it('returns the chat once nobody has written for two hours', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(openNow, 300) },
        minutesBefore(openNow, 125),
        minutesBefore(openNow, 121),
      )

      await expect(service.releaseIdleTakeovers(openNow)).resolves.toBe(1)
      expect(inbox.autoReleaseToBot).toHaveBeenCalledWith(expect.objectContaining({ id: 7, phoneNumberId: 'P1' }))
    })

    it('returns the chat after four hours of operator silence even if the customer just wrote', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(openNow, 300) },
        minutesBefore(openNow, 241),
        minutesBefore(openNow, 2),
      )

      await expect(service.releaseIdleTakeovers(openNow)).resolves.toBe(1)
      expect(inbox.autoReleaseToBot).toHaveBeenCalled()
    })

    it('counts the takeover itself as operator activity (operator has not written yet)', async () => {
      const { service, inbox } = setup({ handedOverAt: minutesBefore(openNow, 5) }, null, minutesBefore(openNow, 1))

      await service.releaseIdleTakeovers(openNow)

      expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
    })
  })

  describe('outside business hours', () => {
    it('returns the chat 30 min after the last operator reply, whatever the customer does', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(closedNow, 90) },
        minutesBefore(closedNow, 31),
        minutesBefore(closedNow, 1),
      )

      await expect(service.releaseIdleTakeovers(closedNow)).resolves.toBe(1)
      expect(inbox.autoReleaseToBot).toHaveBeenCalled()
    })

    it('still waits for the operator timeout', async () => {
      const { service, inbox } = setup(
        { handedOverAt: minutesBefore(closedNow, 90) },
        minutesBefore(closedNow, 10),
        minutesBefore(closedNow, 1),
      )

      await service.releaseIdleTakeovers(closedNow)

      expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
    })

    it('uses the producer business hours when configured', async () => {
      // Office open until 23:00 local → 20:00 ART is still business hours → sticky rules.
      const { service, prisma, inbox } = setup(
        { handedOverAt: minutesBefore(closedNow, 90) },
        minutesBefore(closedNow, 31),
        minutesBefore(closedNow, 1),
      )
      prisma.conversation.findMany.mockResolvedValue([
        {
          id: 7,
          waId: '549341',
          phoneNumberId: 'P1',
          handedOverAt: minutesBefore(closedNow, 90),
          producer: { businessHours: { wed: [{ from: '08:00', to: '23:00' }] } },
        },
      ])

      await service.releaseIdleTakeovers(closedNow)

      expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
    })
  })

  it('only counts operator replies (inbox or WhatsApp Business app) as human activity', async () => {
    const { service, prisma } = setup({ handedOverAt: minutesBefore(openNow, 90) }, minutesBefore(openNow, 31), null)

    await service.releaseIdleTakeovers(openNow)

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ role: 'agent' }, { source: 'app_echo' }] }),
      }),
    )
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: 'user' }) }),
    )
  })

  it('releases a legacy pause that has no timestamps at all', async () => {
    const { service, inbox } = setup({ handedOverAt: null }, null, null)

    await service.releaseIdleTakeovers(openNow)

    expect(inbox.autoReleaseToBot).toHaveBeenCalled()
  })

  it('honours the BOT_TAKEOVER_* overrides', async () => {
    const { service, inbox } = setup(
      { handedOverAt: minutesBefore(openNow, 300) },
      minutesBefore(openNow, 125),
      minutesBefore(openNow, 121),
      { BOT_TAKEOVER_QUIET_MINUTES: '180', BOT_TAKEOVER_MAX_MINUTES: '480' },
    )

    await service.releaseIdleTakeovers(openNow)

    expect(inbox.autoReleaseToBot).not.toHaveBeenCalled()
  })
})
