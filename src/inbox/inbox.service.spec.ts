import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PrismaService } from '../prisma/prisma.service'
import type { BotNotifierService } from './bot-notifier.service'
import type { ListInboxDto } from './dto/list-inbox.dto'
import { InboxService } from './inbox.service'

import type { NovedadesService } from '../novedades/novedades.service'

const novedadesMock = () =>
  ({
    markConversationAnswered: jest.fn().mockResolvedValue(0),
    resolveAnsweredMatters: jest.fn().mockResolvedValue(0),
  }) as unknown as NovedadesService

/** A SuperAdmin of code 2: its chats plus the unattributed ones. */
const SUPERADMIN_CHATS = { codeIds: [2], ownNumbers: null }

describe('InboxService.listConversations', () => {
  it('returns the latest inbound timestamp without exposing the messages helper relation', async () => {
    const lastInboundMessageAt = new Date('2026-09-30T12:00:00.000Z')
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 7,
        waId: '549341',
        phoneNumberId: 'P1',
        contactName: null,
        client: null,
        lastMessageAt: new Date('2026-09-30T12:00:01.000Z'),
        producer: { botEnabled: false },
        messages: [
          {
            role: 'assistant',
            content: 'Hola,\n¿en qué te ayudo?',
            rawData: null,
            createdAt: new Date('2026-09-30T12:00:01.000Z'),
          },
        ],
        _count: { messages: 4 },
      },
    ])
    const groupBy = jest.fn().mockResolvedValue([{ conversationId: 7, _max: { createdAt: lastInboundMessageAt } }])
    const prisma = {
      conversation: { findMany },
      message: { groupBy },
      whatsAppContact: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const notifier = {}
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as BotNotifierService,
      novedadesMock(),
    )

    await expect(service.listConversations(1, SUPERADMIN_CHATS, {} as ListInboxDto)).resolves.toEqual([
      {
        id: 7,
        waId: '549341',
        phoneNumberId: 'P1',
        contactName: null,
        client: null,
        clientIsContact: false,
        lastMessageAt: new Date('2026-09-30T12:00:01.000Z'),
        globalBotDisabled: true,
        customerMessageCount: 4,
        lastInboundMessageAt,
        lastMessage: {
          role: 'assistant',
          content: 'Hola, ¿en qué te ayudo?',
          mediaType: null,
          createdAt: new Date('2026-09-30T12:00:01.000Z'),
        },
      },
    ])
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: { in: [7] }, role: 'user', deletedAt: null },
        _max: { createdAt: true },
      }),
    )
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          messages: expect.objectContaining({ where: { deletedAt: null }, take: 1 }),
          _count: { select: { messages: { where: { role: 'user', deletedAt: null } } } },
          producer: { select: { botEnabled: true } },
        }),
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
    )
  })
})

describe('InboxService.listConversations contact vs. consulted client', () => {
  function setup(conversation: Record<string, unknown>, contacts: unknown[] = []) {
    const prisma = {
      conversation: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { producer: { botEnabled: true }, messages: [], _count: { messages: 1 }, ...conversation },
          ]),
      },
      message: { groupBy: jest.fn().mockResolvedValue([]) },
      whatsAppContact: { findMany: jest.fn().mockResolvedValue(contacts) },
    }
    return new InboxService(prisma as unknown as PrismaService, {} as BotNotifierService, novedadesMock())
  }
  const adriana = { id: 5, firstName: 'Adriana', lastName: 'Gómez', dni: '20111222' }

  it('keeps the writer as the contact when they asked with someone else’s DNI', async () => {
    const service = setup({
      id: 7,
      waId: '5493413404951',
      phoneNumberId: 'P1',
      contactName: 'John',
      client: { ...adriana, phone: '341156930749' },
    })

    const [conversation] = await service.listConversations(1, SUPERADMIN_CHATS, {} as ListInboxDto)

    expect(conversation).toMatchObject({ contactName: 'John', clientIsContact: false, client: adriana })
    expect(conversation.client).not.toHaveProperty('phone', expect.anything())
  })

  it('recognizes the client as the writer when their phone is this WhatsApp number', async () => {
    const service = setup({
      id: 7,
      waId: '5493413404951',
      phoneNumberId: 'P1',
      contactName: null,
      client: { ...adriana, phone: '341153404951' },
    })

    const [conversation] = await service.listConversations(1, SUPERADMIN_CHATS, {} as ListInboxDto)

    expect(conversation.clientIsContact).toBe(true)
  })

  it('prefers a name set by hand over the address book and the profile', async () => {
    const service = setup(
      {
        id: 7,
        waId: '5493413404951',
        phoneNumberId: 'P1',
        contactName: 'johnny',
        contactNameManual: 'John P.',
        client: null,
      },
      [
        {
          waId: '5493413404951',
          phone: '5493413404951',
          fullName: 'John Pellegrini',
          phoneNumber: { phoneNumberId: 'P1' },
        },
      ],
    )

    const [conversation] = await service.listConversations(1, SUPERADMIN_CHATS, {} as ListInboxDto)

    expect(conversation.contactName).toBe('John P.')
  })

  it('prefers the name saved in the WhatsApp Business address book', async () => {
    const service = setup({ id: 7, waId: '5493413404951', phoneNumberId: 'P1', contactName: 'johnny', client: null }, [
      {
        waId: '5493413404951',
        phone: '5493413404951',
        fullName: 'John Pellegrini',
        phoneNumber: { phoneNumberId: 'P1' },
      },
    ])

    const [conversation] = await service.listConversations(1, SUPERADMIN_CHATS, {} as ListInboxDto)

    expect(conversation.contactName).toBe('John Pellegrini')
  })
})

describe('InboxService.updateContact', () => {
  function setup() {
    const prisma = {
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 7, waId: '549341', producerId: 1, producer: { botEnabled: true } }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 7,
            waId: '5493413404951',
            contactName: 'Adri',
            contactNameManual: 'contactNameManual' in data ? data.contactNameManual : null,
            client:
              data.clientId === null ? null : { id: 5, firstName: 'Adriana', lastName: 'Gómez', dni: '1', phone: null },
          }),
        ),
      },
    }
    return {
      prisma,
      service: new InboxService(prisma as unknown as PrismaService, {} as BotNotifierService, novedadesMock()),
    }
  }

  it('shows the name set by hand and unlinks a client attached by mistake', async () => {
    const { prisma, service } = setup()

    const result = await service.updateContact(7, 1, SUPERADMIN_CHATS, {
      contactName: '  John Pellegrini ',
      unlinkClient: true,
    })

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: { contactNameManual: 'John Pellegrini', clientId: null, clientLinkedAt: null },
      }),
    )
    expect(result).toMatchObject({ contactName: 'John Pellegrini', client: null, clientIsContact: false })
  })

  it('goes back to the automatic name when the field is cleared, keeping the client', async () => {
    const { prisma, service } = setup()

    const result = await service.updateContact(7, 1, SUPERADMIN_CHATS, { contactName: '' })

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { contactNameManual: null } }),
    )
    expect(result.contactName).toBe('Adri')
    expect(result.client).not.toBeNull()
  })

  it('rejects a conversation outside the user scope', async () => {
    const { prisma, service } = setup()
    prisma.conversation.findFirst.mockResolvedValue(null)

    await expect(service.updateContact(99, 1, SUPERADMIN_CHATS, { unlinkClient: true })).rejects.toThrow('not found')
    expect(prisma.conversation.update).not.toHaveBeenCalled()
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
    const service = new InboxService(prisma as unknown as PrismaService, {} as BotNotifierService, novedadesMock())

    const result = await service.getMessages(7, 1, SUPERADMIN_CHATS)

    expect(result[0].media?.url).toMatch(/^\/uploads\/siniestros\/a\.webp\?exp=\d+&sig=/)
    // The whole stored history, not just the current bot session.
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 7, deletedAt: null, createdAt: { lte: expect.any(Date) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    )
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
      phoneNumber: { findUnique: jest.fn().mockResolvedValue({ isActive: true, deletedAt: null, wabaAccount: null }) },
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    const notifier = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    const novedades = novedadesMock()
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as BotNotifierService,
      novedades,
    )

    await expect(service.sendMessage(7, 1, SUPERADMIN_CHATS, 9, 'Te atiendo')).resolves.toEqual(created)
    expect(notifier.sendMessage).toHaveBeenCalledWith('549341', 'Te atiendo', 'P1')
    // The reply from the panel is the office handling what the chat asked for.
    expect(novedades.markConversationAnswered).toHaveBeenCalledWith(7, now)
  })
})

describe('InboxService.sendMessage on a number that is off WhatsApp', () => {
  function setup(phone: unknown) {
    const now = new Date()
    const conversation = {
      id: 7,
      waId: '549341',
      producerId: 1,
      botPaused: true,
      producer: { botEnabled: true },
      phoneNumberId: 'P1',
      sessionStartedAt: now,
    }
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      message: { findFirst: jest.fn().mockResolvedValue({ createdAt: now }) },
      phoneNumber: { findUnique: jest.fn().mockResolvedValue(phone) },
      $transaction: jest.fn(),
    }
    const notifier = { sendMessage: jest.fn() }
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as BotNotifierService,
      novedadesMock(),
    )
    return { service, prisma, notifier }
  }

  it('tells the agent Meta dropped the number instead of pretending the reply went out', async () => {
    const { service, prisma, notifier } = setup({
      isActive: true,
      deletedAt: null,
      wabaAccount: { disconnectedAt: new Date('2026-10-19T18:29:28.000Z') },
    })

    await expect(service.sendMessage(7, 1, SUPERADMIN_CHATS, 9, 'Hola')).rejects.toThrow('desconectado de Meta')
    expect(prisma.phoneNumber.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumberId: 'P1' } }),
    )
    expect(notifier.sendMessage).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('refuses to send through a number removed from Números', async () => {
    const { service, notifier } = setup({ isActive: false, deletedAt: new Date(), wabaAccount: null })

    await expect(service.sendMessage(7, 1, SUPERADMIN_CHATS, 9, 'Hola')).rejects.toThrow('dado de baja')
    expect(notifier.sendMessage).not.toHaveBeenCalled()
  })
})

describe('InboxService.autoReleaseToBot', () => {
  function setup(updated: number) {
    const prisma = { conversation: { updateMany: jest.fn().mockResolvedValue({ count: updated }) } }
    const notifier = { resetFlow: jest.fn().mockResolvedValue(undefined) }
    const novedades = novedadesMock()
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as BotNotifierService,
      novedades,
    )
    return { service, prisma, notifier, novedades }
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

  it('closes what the office was handling once the chat is back with the bot', async () => {
    const { service, novedades } = setup(1)
    await service.autoReleaseToBot(conversation)
    expect(novedades.resolveAnsweredMatters).toHaveBeenCalledWith(7)
  })

  it('does nothing when someone already released it', async () => {
    const { service, notifier, novedades } = setup(0)

    await expect(service.autoReleaseToBot(conversation)).resolves.toBe(false)
    expect(notifier.resetFlow).not.toHaveBeenCalled()
    expect(novedades.resolveAnsweredMatters).not.toHaveBeenCalled()
  })
})

describe('InboxService.deleteConversations', () => {
  function setup(rows: Array<{ id: number; waId: string; phoneNumberId: string | null }> = []) {
    const tx = {
      conversation: { findMany: jest.fn().mockResolvedValue(rows), updateMany: jest.fn(), deleteMany: jest.fn() },
      message: { deleteMany: jest.fn() },
      contactLead: { updateMany: jest.fn() },
      notification: { updateMany: jest.fn() },
    }
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    const notifier = { resetFlow: jest.fn().mockResolvedValue(undefined) }
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as BotNotifierService,
      novedadesMock(),
    )
    return { service, tx, notifier }
  }

  it('scopes individual deletion and preserves business records', async () => {
    const { service, tx, notifier } = setup([{ id: 7, waId: '549341', phoneNumberId: 'P1' }])
    await expect(service.deleteConversations(1, SUPERADMIN_CHATS, 7)).resolves.toEqual({ deletedCount: 1 })
    const scope = {
      producerId: 1,
      deletedAt: null,
      id: 7,
      AND: [{ OR: [{ producerCodeId: { in: [2] } }, { producerCodeId: null }] }],
    }
    expect(tx.conversation.findMany).toHaveBeenCalledWith({
      where: scope,
      select: { id: true, phoneNumberId: true, waId: true },
    })
    expect(tx.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: [7] } } })
    expect(tx.contactLead.updateMany).toHaveBeenCalledWith({
      where: { producerId: 1, conversationId: { in: [7] } },
      data: { conversationId: null },
    })
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { producerId: 1, type: 'handoff', refId: { in: [7] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(tx.conversation.deleteMany).toHaveBeenCalledWith({ where: { ...scope, id: { in: [7] } } })
    expect(notifier.resetFlow).toHaveBeenCalledWith('P1', '549341')
  })

  it('rejects nonexistent or unauthorized chats without deleting anything', async () => {
    const { service, tx, notifier } = setup()
    await expect(service.deleteConversations(1, SUPERADMIN_CHATS, 99)).rejects.toThrow('Conversation not found')
    expect(tx.message.deleteMany).not.toHaveBeenCalled()
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled()
    expect(notifier.resetFlow).not.toHaveBeenCalled()
  })

  it('deletes all accessible statuses independently of UI filters', async () => {
    const { service, tx, notifier } = setup([
      { id: 7, waId: 'one', phoneNumberId: 'P1' },
      { id: 8, waId: 'two', phoneNumberId: null },
    ])
    await expect(service.deleteConversations(1, SUPERADMIN_CHATS)).resolves.toEqual({ deletedCount: 2 })
    expect(tx.conversation.findMany.mock.calls[0][0].where).toEqual({
      producerId: 1,
      deletedAt: null,
      AND: [{ OR: [{ producerCodeId: { in: [2] } }, { producerCodeId: null }] }],
    })
    expect(tx.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: [7, 8] } } })
    expect(notifier.resetFlow).toHaveBeenCalledTimes(1)
  })

  it('allows clearing an empty inbox', async () => {
    const { service, tx } = setup()
    await expect(service.deleteConversations(1, { codeIds: [], ownNumbers: null })).resolves.toEqual({
      deletedCount: 0,
    })
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled()
  })

  it('does not reset bot memory if the transaction fails', async () => {
    const { service, tx, notifier } = setup([{ id: 7, waId: 'one', phoneNumberId: 'P1' }])
    tx.message.deleteMany.mockRejectedValue(new Error('database unavailable'))
    await expect(service.deleteConversations(1, SUPERADMIN_CHATS, 7)).rejects.toThrow('database unavailable')
    expect(tx.conversation.deleteMany).not.toHaveBeenCalled()
    expect(notifier.resetFlow).not.toHaveBeenCalled()
  })
})

describe('InboxService.sendMedia', () => {
  const now = new Date()
  const conversation = {
    id: 7,
    waId: '549341',
    producerId: 1,
    botPaused: true,
    producer: { botEnabled: true },
    phoneNumberId: 'P1',
    sessionStartedAt: now,
  }

  function setup(sendMedia = jest.fn().mockResolvedValue(undefined)) {
    const tx = {
      message: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { content: string } }) =>
            Promise.resolve({ id: 3, role: 'agent', content: data.content, createdAt: now }),
          ),
      },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      message: { findFirst: jest.fn().mockResolvedValue({ createdAt: now }) },
      phoneNumber: { findUnique: jest.fn().mockResolvedValue({ isActive: true, deletedAt: null, wabaAccount: null }) },
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    const notifier = { sendMedia }
    const service = new InboxService(
      prisma as unknown as PrismaService,
      notifier as unknown as BotNotifierService,
      novedadesMock(),
    )
    return { service, tx, notifier }
  }

  function upload(mimetype: string, size: number, originalname: string): Express.Multer.File {
    const path = join(mkdtempSync(join(tmpdir(), 'inbox-media-')), 'upload')
    writeFileSync(path, 'x')
    return { path, filename: 'upload', mimetype, size, originalname } as Express.Multer.File
  }

  it('sends a PDF through the bot and stores it with a placeholder', async () => {
    const { service, tx, notifier } = setup()
    // Multer hands the multipart filename over as latin1.
    const file = upload('application/pdf', 1000, Buffer.from('Póliza.pdf', 'utf8').toString('latin1'))

    const result = await service.sendMedia(7, 1, SUPERADMIN_CHATS, file)

    expect(notifier.sendMedia).toHaveBeenCalledWith({
      to: '549341',
      phoneNumberId: 'P1',
      path: file.path,
      mimeType: 'application/pdf',
      filename: 'Póliza.pdf',
      caption: undefined,
    })
    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'agent',
          content: '[documento Póliza.pdf]',
          rawData: {
            media: {
              url: '/uploads/inbox/upload',
              originalName: 'Póliza.pdf',
              mimeType: 'application/pdf',
              size: 1000,
            },
          },
        }),
      }),
    )
    expect(result.media).toMatchObject({ originalName: 'Póliza.pdf', mimeType: 'application/pdf' })
    expect(existsSync(file.path)).toBe(true)
  })

  it('keeps the caption as the message text', async () => {
    const { service, tx, notifier } = setup()
    const file = upload('image/jpeg', 1000, 'foto.jpg')

    await service.sendMedia(7, 1, SUPERADMIN_CHATS, file, '  Tu cupón de octubre  ')

    expect(notifier.sendMedia).toHaveBeenCalledWith(expect.objectContaining({ caption: 'Tu cupón de octubre' }))
    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Tu cupón de octubre' }) }),
    )
  })

  it('rejects a photo over WhatsApp’s 5 MB and removes the upload', async () => {
    const { service, notifier } = setup()
    const file = upload('image/png', 6 * 1024 * 1024, 'grande.png')

    await expect(service.sendMedia(7, 1, SUPERADMIN_CHATS, file)).rejects.toThrow('5 MB')
    expect(notifier.sendMedia).not.toHaveBeenCalled()
    expect(existsSync(file.path)).toBe(false)
  })

  it('removes the upload and stores nothing when WhatsApp delivery fails', async () => {
    const { service, tx } = setup(jest.fn().mockRejectedValue(new Error('bot down')))
    const file = upload('application/pdf', 1000, 'poliza.pdf')

    await expect(service.sendMedia(7, 1, SUPERADMIN_CHATS, file)).rejects.toThrow('bot down')
    expect(tx.message.create).not.toHaveBeenCalled()
    expect(existsSync(file.path)).toBe(false)
  })
})

describe("an admin's inbox", () => {
  // Their only number is the branch's; chat 251 came through the main line.
  const ADMIN_CHATS = { codeIds: [4], ownNumbers: ['BRANCH'] }

  function setup(conversation: Record<string, jest.Mock>) {
    const prisma = {
      conversation,
      message: { groupBy: jest.fn().mockResolvedValue([]) },
      whatsAppContact: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return new InboxService(prisma as unknown as PrismaService, {} as BotNotifierService, novedadesMock())
  }

  it('lists only the chats that came through their own numbers, whatever their code', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    await setup({ findMany }).listConversations(1, ADMIN_CHATS, {} as ListInboxDto)

    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ phoneNumberId: { in: ['BRANCH'] } }])
  })

  it('does not open, take over or answer a chat of another number', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const service = setup({ findFirst })

    await expect(service.getMessages(251, 1, ADMIN_CHATS)).rejects.toThrow('not found')
    await expect(service.takeover(251, 1, ADMIN_CHATS, 4)).rejects.toThrow('not found')
    await expect(service.sendMessage(251, 1, ADMIN_CHATS, 4, 'Hola')).rejects.toThrow('not found')
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 251,
      producerId: 1,
      deletedAt: null,
      AND: [{ phoneNumberId: { in: ['BRANCH'] } }],
    })
  })

  it('sees no chat while they have no number of their own', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    await setup({ findMany }).listConversations(1, { codeIds: [4], ownNumbers: [] }, {} as ListInboxDto)

    expect(findMany.mock.calls[0][0].where.AND).toEqual([{ phoneNumberId: { in: [] } }])
  })
})
