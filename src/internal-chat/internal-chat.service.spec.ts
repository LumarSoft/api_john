import { InternalChatKind, Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { PlanFeaturesService } from '../plan-features/plan-features.service'
import { InternalChatService, type ChatActor } from './internal-chat.service'

const john: ChatActor = { id: 1, producerId: 7, role: Role.SUPERADMIN }
const mili: ChatActor = { id: 2, producerId: 7, role: Role.ADMIN }
const lumar: ChatActor = { id: 9, producerId: 1, role: Role.OWNER }

const person = (id: number, name: string) => ({ id, name, email: `${name.toLowerCase()}@example.com` })

function setup() {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ createdAt: new Date('2026-11-01T12:00:00Z') }),
    },
    internalChat: {
      // The team chat exists and the person already has their row in it.
      findUnique: jest.fn().mockResolvedValue({ id: 5, members: [{ id: 50 }] }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 5 }),
      create: jest.fn().mockResolvedValue({ id: 6 }),
      update: jest.fn().mockResolvedValue({}),
    },
    internalChatMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 51, lastReadMessageId: null }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    internalChatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 30, createdAt: new Date('2026-11-03T15:00:00Z') }),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma))
  const planFeatures = { hasFeature: jest.fn().mockResolvedValue(true) }
  return {
    service: new InternalChatService(
      prisma as unknown as PrismaService,
      planFeatures as unknown as PlanFeaturesService,
    ),
    prisma,
    planFeatures,
  }
}

describe('InternalChatService — who takes part', () => {
  it('keeps the platform OWNER out of the office chat', async () => {
    const { service, prisma } = setup()

    await expect(service.listChats(lumar)).rejects.toThrow('for the office')
    await expect(service.unread(lumar)).rejects.toThrow('for the office')
    await expect(service.people(lumar)).rejects.toThrow('for the office')
    expect(prisma.internalChat.findUnique).not.toHaveBeenCalled()
  })

  it('answers 403 when the plans of the organization leave the chat out', async () => {
    const { service, prisma, planFeatures } = setup()
    planFeatures.hasFeature.mockResolvedValue(false)

    await expect(service.listChats(mili)).rejects.toThrow('no incluye el chat interno')
    await expect(service.send(mili, 5, { body: 'hola' })).rejects.toThrow('no incluye el chat interno')
    expect(planFeatures.hasFeature).toHaveBeenCalledWith(7, 'internal_chat')
    expect(prisma.internalChatMessage.create).not.toHaveBeenCalled()
  })

  it('reuses the plan check of the organization for a while', async () => {
    const { service, planFeatures } = setup()

    await service.people(mili)
    await service.people(john)
    await service.unread(mili)

    expect(planFeatures.hasFeature).toHaveBeenCalledTimes(1)
  })

  it('lists coworkers of the same organization, without oneself or the OWNER', async () => {
    const { service, prisma } = setup()

    await service.people(mili)

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { producerId: 7, deletedAt: null, role: { not: Role.OWNER }, id: { not: 2 } },
      }),
    )
  })
})

describe('InternalChatService.listChats', () => {
  it('creates the team chat the first time and leaves older history as read', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findUnique.mockResolvedValue(null)
    prisma.internalChat.create.mockResolvedValue({ id: 5 })
    prisma.internalChatMessage.findFirst.mockResolvedValue({ id: 12 })

    await service.listChats(mili)

    expect(prisma.internalChat.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { producerId: 7, kind: InternalChatKind.TEAM, key: 'team' } }),
    )
    // Only messages written before the person's user was created count as read.
    expect(prisma.internalChatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 5, createdAt: { lt: new Date('2026-11-01T12:00:00Z') } } }),
    )
    expect(prisma.internalChatMember.create).toHaveBeenCalledWith({
      data: { chatId: 5, userId: 2, lastReadMessageId: 12 },
    })
  })

  it('joins an existing team chat when two people open it at once', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findUnique.mockResolvedValue(null)
    prisma.internalChat.create.mockRejectedValue({ code: 'P2002' })

    await service.listChats(mili)

    expect(prisma.internalChat.findUniqueOrThrow).toHaveBeenCalled()
    expect(prisma.internalChatMember.create).toHaveBeenCalledWith({
      data: { chatId: 5, userId: 2, lastReadMessageId: null },
    })
  })

  it('puts the team first, then the direct chats by latest activity, with unread counts', async () => {
    const { service, prisma } = setup()
    const chat = (
      id: number,
      kind: InternalChatKind,
      lastMessageAt: string | null,
      other?: ReturnType<typeof person>,
    ) => ({
      lastReadMessageId: 3,
      chat: {
        id,
        kind,
        lastMessageAt: lastMessageAt ? new Date(lastMessageAt) : null,
        members: other ? [{ user: other }] : [],
        messages: [],
      },
    })
    prisma.internalChatMember.findMany.mockResolvedValue([
      chat(8, InternalChatKind.DIRECT, '2026-11-02T10:00:00Z', person(3, 'Demis')),
      chat(5, InternalChatKind.TEAM, '2026-11-01T10:00:00Z'),
      chat(9, InternalChatKind.DIRECT, '2026-11-03T10:00:00Z', person(1, 'John')),
    ])
    prisma.internalChatMessage.groupBy.mockResolvedValue([{ chatId: 9, _count: { _all: 2 } }])

    const chats = await service.listChats(mili)

    expect(chats.map(c => [c.id, c.person?.name ?? null, c.unread])).toEqual([
      [5, null, 0],
      [9, 'John', 2],
      [8, 'Demis', 0],
    ])
    expect(prisma.internalChatMessage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          senderId: { not: 2 },
          OR: [
            { chatId: 8, id: { gt: 3 } },
            { chatId: 5, id: { gt: 3 } },
            { chatId: 9, id: { gt: 3 } },
          ],
        },
      }),
    )
  })
})

describe('InternalChatService.openDirect', () => {
  it('creates one chat per pair, with both people in it', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findUnique.mockResolvedValue(null)

    await service.openDirect(mili, { userId: 1 })

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, producerId: 7, deletedAt: null, role: { not: Role.OWNER } } }),
    )
    expect(prisma.internalChat.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          producerId: 7,
          kind: InternalChatKind.DIRECT,
          key: 'direct:1:2',
          members: { create: [{ userId: 2 }, { userId: 1 }] },
        },
      }),
    )
  })

  it('reuses the chat the other person already opened', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findUnique.mockResolvedValue({ id: 8 })

    await service.openDirect(john, { userId: 2 })

    expect(prisma.internalChat.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { producerId_key: { producerId: 7, key: 'direct:1:2' } } }),
    )
    expect(prisma.internalChat.create).not.toHaveBeenCalled()
  })

  it('rejects oneself and people from another office', async () => {
    const { service, prisma } = setup()
    await expect(service.openDirect(mili, { userId: 2 })).rejects.toThrow('someone else')

    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.openDirect(mili, { userId: 99 })).rejects.toThrow('not part of this office')
    expect(prisma.internalChat.create).not.toHaveBeenCalled()
  })
})

describe('InternalChatService — messages', () => {
  it('hides a direct chat of two other people', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findFirst.mockResolvedValue({ kind: InternalChatKind.DIRECT, members: [] })

    await expect(service.messages(mili, 8, {})).rejects.toThrow('not found')
    await expect(service.send(mili, 8, { body: 'hola' })).rejects.toThrow('not found')
    expect(prisma.internalChatMessage.create).not.toHaveBeenCalled()
  })

  it('only opens chats of the person’s own organization', async () => {
    const { service, prisma } = setup()

    await expect(service.messages(mili, 40, {})).rejects.toThrow('not found')
    expect(prisma.internalChat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 40, producerId: 7, deletedAt: null } }),
    )
  })

  it('pages back from the newest message and says whether there are older ones', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findFirst.mockResolvedValue({ kind: InternalChatKind.TEAM, members: [{ id: 50 }] })
    prisma.internalChatMessage.findMany.mockResolvedValue([{ id: 9 }, { id: 8 }, { id: 7 }])

    const page = await service.messages(mili, 5, { beforeId: 10, limit: 2 })

    expect(prisma.internalChatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 5, deletedAt: null, id: { lt: 10 } }, take: 3 }),
    )
    expect(page.messages.map(m => m.id)).toEqual([8, 9])
    expect(page.hasMore).toBe(true)
  })

  it('sends a message, moves the chat up and marks it read for the sender', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findFirst.mockResolvedValue({
      kind: InternalChatKind.DIRECT,
      members: [{ id: 51, lastReadMessageId: 20 }],
    })

    await service.send(mili, 8, { body: '¿Quién llama a Pérez?' })

    expect(prisma.internalChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { chatId: 8, senderId: 2, body: '¿Quién llama a Pérez?' } }),
    )
    expect(prisma.internalChat.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { lastMessageAt: new Date('2026-11-03T15:00:00Z') },
    })
    expect(prisma.internalChatMember.update).toHaveBeenCalledWith({
      where: { id: 51 },
      data: { lastReadMessageId: 30 },
    })
  })

  it('moves the read mark forward only', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findFirst.mockResolvedValue({
      kind: InternalChatKind.TEAM,
      members: [{ id: 50, lastReadMessageId: 40 }],
    })
    prisma.internalChatMessage.findFirst.mockResolvedValue({ id: 35 })
    prisma.internalChatMember.updateMany.mockResolvedValue({ count: 0 })

    const result = await service.markRead(mili, 5, { messageId: 35 })

    expect(prisma.internalChatMember.updateMany).toHaveBeenCalledWith({
      where: { id: 50, OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: 35 } }] },
      data: { lastReadMessageId: 35 },
    })
    expect(result).toEqual({ lastReadMessageId: 40 })
  })

  it('rejects a read mark on a message of another chat', async () => {
    const { service, prisma } = setup()
    prisma.internalChat.findFirst.mockResolvedValue({ kind: InternalChatKind.TEAM, members: [{ id: 50 }] })

    await expect(service.markRead(mili, 5, { messageId: 99 })).rejects.toThrow('not part of this chat')
    expect(prisma.internalChatMember.updateMany).not.toHaveBeenCalled()
  })

  it('lets only the sender delete a message, softly', async () => {
    const { service, prisma } = setup()

    await expect(service.removeMessage(mili, 30)).rejects.toThrow('not found')
    expect(prisma.internalChatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 30, senderId: 2, deletedAt: null, chat: { producerId: 7, deletedAt: null } },
      }),
    )

    prisma.internalChatMessage.findFirst.mockResolvedValue({ id: 30 })
    await service.removeMessage(mili, 30)
    expect(prisma.internalChatMessage.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { deletedAt: expect.any(Date) as Date },
    })
  })
})

describe('InternalChatService.unread', () => {
  it('counts what others wrote after each read mark and returns the newest', async () => {
    const { service, prisma } = setup()
    prisma.internalChatMember.findMany.mockResolvedValue([
      { chatId: 5, lastReadMessageId: 10 },
      { chatId: 8, lastReadMessageId: null },
    ])
    prisma.internalChatMessage.count.mockResolvedValue(3)
    prisma.internalChatMessage.findFirst.mockResolvedValue({ id: 14, body: 'Ya llamé' })

    const result = await service.unread(mili)

    const where = {
      deletedAt: null,
      senderId: { not: 2 },
      OR: [
        { chatId: 5, id: { gt: 10 } },
        { chatId: 8, id: { gt: 0 } },
      ],
    }
    expect(prisma.internalChatMessage.count).toHaveBeenCalledWith({ where })
    expect(result).toEqual({ total: 3, latest: { id: 14, body: 'Ya llamé' } })
  })
})
