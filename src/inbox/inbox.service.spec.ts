import type { PrismaService } from '../prisma/prisma.service'
import type { BotNotifierService } from './bot-notifier.service'
import type { ListInboxDto } from './dto/list-inbox.dto'
import { InboxService } from './inbox.service'

describe('InboxService.listConversations', () => {
  it('returns the latest inbound timestamp without exposing the messages helper relation', async () => {
    const lastInboundMessageAt = new Date('2026-09-30T12:00:00.000Z')
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 7,
        waId: '549341',
        lastMessageAt: new Date('2026-09-30T12:00:01.000Z'),
        messages: [{ createdAt: lastInboundMessageAt }],
      },
    ])
    const prisma = { conversation: { findMany } }
    const notifier = {}
    const service = new InboxService(prisma as unknown as PrismaService, notifier as BotNotifierService)

    await expect(service.listConversations(1, [2], {} as ListInboxDto)).resolves.toEqual([
      {
        id: 7,
        waId: '549341',
        lastMessageAt: new Date('2026-09-30T12:00:01.000Z'),
        lastInboundMessageAt,
      },
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          messages: expect.objectContaining({ where: { role: 'user', deletedAt: null }, take: 1 }),
        }),
      }),
    )
  })
})

describe('InboxService.autoReleaseToBot', () => {
  function setup(updated: number) {
    const prisma = { conversation: { updateMany: jest.fn().mockResolvedValue({ count: updated }) } }
    const notifier = { resetFlow: jest.fn().mockResolvedValue(undefined) }
    const service = new InboxService(prisma as unknown as PrismaService, notifier as unknown as BotNotifierService)
    return { service, prisma, notifier }
  }

  const conversation = { id: 7, phoneNumberId: 'P1', waId: '549341' }

  it('hands a paused conversation back and restarts the bot from the menu', async () => {
    const { service, prisma, notifier } = setup(1)

    await expect(service.autoReleaseToBot(conversation)).resolves.toBe(true)

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 7, botPaused: true },
      data: { botPaused: false, assignedToUserId: null, handedOverAt: null, status: 'open', flowState: null },
    })
    expect(notifier.resetFlow).toHaveBeenCalledWith('P1', '549341')
  })

  it('does nothing when someone already released it', async () => {
    const { service, notifier } = setup(0)

    await expect(service.autoReleaseToBot(conversation)).resolves.toBe(false)
    expect(notifier.resetFlow).not.toHaveBeenCalled()
  })
})
