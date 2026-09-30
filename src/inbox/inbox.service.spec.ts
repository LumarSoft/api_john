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
        producer: { botEnabled: false },
        messages: [{ createdAt: lastInboundMessageAt }],
        _count: { messages: 4 },
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
        globalBotDisabled: true,
        customerMessageCount: 4,
        lastInboundMessageAt,
      },
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          messages: expect.objectContaining({ where: { role: 'user', deletedAt: null }, take: 1 }),
          _count: { select: { messages: { where: { role: 'user', deletedAt: null } } } },
          producer: { select: { botEnabled: true } },
        }),
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
    )
  })
})

describe('InboxService.getMessages', () => {
  it('signs media URLs and clears unread state without racing a newer message', async () => {
    process.env.JWT_SECRET = 'test-secret'
    const createdAt = new Date('2026-09-30T12:00:00.000Z')
    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          waId: '549341',
          producerId: 1,
          botPaused: false,
          producer: { botEnabled: true },
          phoneNumberId: 'P1',
          sessionStartedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 9,
            role: 'user',
            content: '[foto]',
            rawData: {
              media: {
                url: '/uploads/siniestros/a.webp',
                originalName: 'a.webp',
                mimeType: 'image/webp',
                size: 42,
              },
            },
            createdAt,
          },
        ]),
      },
    }
    const service = new InboxService(prisma as unknown as PrismaService, {} as BotNotifierService)

    const result = await service.getMessages(7, 1, [2])

    expect(result[0].media?.url).toMatch(/^\/uploads\/siniestros\/a\.webp\?exp=\d+&sig=/)
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 7, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: expect.any(Date) } }] },
      data: { unreadCount: 0, lastReadAt: expect.any(Date) },
    })
  })
})

describe('InboxService.sendMessage with global human attention', () => {
  it('allows an advisor reply without taking the chat individually', async () => {
    const now = new Date()
    const conversation = {
      id: 7,
      waId: '549341',
      producerId: 1,
      botPaused: false,
      producer: { botEnabled: false },
      phoneNumberId: 'P1',
      sessionStartedAt: now,
    }
    const created = { id: 3, role: 'agent', content: 'Te atiendo', createdAt: now }
    const tx = {
      message: { create: jest.fn().mockResolvedValue(created) },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      message: { findFirst: jest.fn().mockResolvedValue({ createdAt: now }) },
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    const notifier = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    const service = new InboxService(prisma as unknown as PrismaService, notifier as unknown as BotNotifierService)

    await expect(service.sendMessage(7, 1, [2], 9, 'Te atiendo')).resolves.toEqual(created)
    expect(notifier.sendMessage).toHaveBeenCalledWith('549341', 'Te atiendo', 'P1')
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
