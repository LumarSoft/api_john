import { CoexistenceSyncService } from './coexistence-sync.service'

function createPrismaMock() {
  return {
    phoneNumber: {
      findUnique: jest.fn().mockResolvedValue({ id: 9, producerId: 3 }),
      update: jest.fn().mockResolvedValue({}),
    },
    conversation: {
      upsert: jest.fn().mockResolvedValue({ id: 21 }),
    },
    message: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    whatsAppContact: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  }
}

describe('CoexistenceSyncService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: CoexistenceSyncService

  beforeEach(() => {
    prisma = createPrismaMock()
    service = new CoexistenceSyncService(prisma as any)
  })

  it('persists historical messages with their original time and no active session', async () => {
    const result = await service.persistHistory({
      phoneNumberId: 'META-P1',
      chunks: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 100 },
          threads: [
            {
              id: '+54 9 341 234-5678',
              messages: [
                {
                  from: '5493412345678',
                  to: 'business',
                  id: 'wamid.user',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Hola' },
                },
                {
                  from: 'business',
                  to: '5493412345678',
                  id: 'wamid.business',
                  timestamp: '1700000001',
                  type: 'image',
                  image: { caption: 'La póliza' },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { waId_producerId: { waId: '5493412345678', producerId: 3 } },
        create: expect.objectContaining({ status: 'closed', sessionStartedAt: expect.any(Date) }),
      }),
    )
    expect(prisma.message.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          role: 'user',
          content: 'Hola',
          waMessageId: 'wamid.user',
          source: 'history',
          createdAt: new Date(1700000000 * 1000),
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'La póliza',
          waMessageId: 'wamid.business',
          source: 'history',
          createdAt: new Date(1700000001 * 1000),
        }),
      ],
    })
    expect(result).toEqual(expect.objectContaining({ threads: 1, receivedMessages: 2, insertedMessages: 2 }))
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { historyLastSyncedAt: expect.any(Date) } }),
    )
  })

  it('skips history errors and messages without a Meta id', async () => {
    prisma.message.createMany.mockClear()

    const result = await service.persistHistory({
      phoneNumberId: 'META-P1',
      chunks: [
        { errors: [{ code: 2593109 }] },
        { threads: [{ id: '5493412345678', messages: [{ type: 'text', text: { body: 'sin id' } }] }] },
      ],
    })

    expect(prisma.message.createMany).not.toHaveBeenCalled()
    expect(result.skippedMessages).toBe(1)
    expect(result.errorChunks).toBe(1)
    expect(result.syncedAt).toBeNull()
    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
  })

  it('does not import reactions as messages', async () => {
    prisma.message.createMany.mockClear()

    const result = await service.persistHistory({
      phoneNumberId: 'META-P1',
      chunks: [
        {
          threads: [
            {
              id: '5493410000000',
              messages: [
                {
                  from: 'business',
                  to: '5493410000000',
                  id: 'wamid.reaction',
                  timestamp: '1700000002',
                  type: 'reaction',
                  reaction: { message_id: 'wamid.user', emoji: '👍' },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(prisma.message.createMany).not.toHaveBeenCalled()
    expect(result.skippedMessages).toBe(1)
  })

  it('upserts contact additions and soft-deletes removals', async () => {
    const result = await service.persistContacts({
      phoneNumberId: 'META-P1',
      contacts: [
        {
          type: 'contact',
          action: 'add',
          contact: { phone_number: '+54 9 341 234-5678', full_name: 'Ana Pérez', first_name: 'Ana' },
          metadata: { timestamp: '1700000000' },
        },
        {
          type: 'contact',
          action: 'remove',
          contact: { phone_number: '5493411111111' },
          metadata: { timestamp: '1700000001' },
        },
      ],
    })

    expect(prisma.whatsAppContact.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { phoneNumberId_phone: { phoneNumberId: 9, phone: '5493412345678' } },
        update: expect.objectContaining({ fullName: 'Ana Pérez', deletedAt: null }),
      }),
    )
    expect(prisma.whatsAppContact.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: expect.objectContaining({ lastAction: 'remove', deletedAt: expect.any(Date) }),
      }),
    )
    expect(result).toEqual(expect.objectContaining({ upsertedContacts: 2, removedContacts: 1 }))
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { contactsLastSyncedAt: expect.any(Date) } }),
    )
  })

  it('reads address-book timestamps sent in milliseconds', async () => {
    // Shape of the change Meta sent on 06/11 when the office saved a contact in the app.
    await service.persistContacts({
      phoneNumberId: 'META-P1',
      contacts: [
        {
          type: 'contact',
          action: 'add',
          contact: { full_name: 'Ana Pérez', first_name: 'Ana', phone_number: '5493412345678' },
          metadata: { timestamp: '1793969865079' },
        },
        {
          type: 'contact',
          action: 'remove',
          contact: { phone_number: '5493411111111' },
          metadata: { timestamp: '1793969865080' },
        },
      ],
    })

    expect(prisma.whatsAppContact.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({ sourceUpdatedAt: new Date(1793969865079), deletedAt: null }),
      }),
    )
    expect(prisma.whatsAppContact.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: expect.objectContaining({ deletedAt: new Date(1793969865080) }),
      }),
    )
  })

  it('still reads history timestamps sent in seconds', async () => {
    await service.persistContacts({
      phoneNumberId: 'META-P1',
      contacts: [
        {
          type: 'contact',
          action: 'add',
          contact: { phone_number: '5493412345678' },
          metadata: { timestamp: '1700000000' },
        },
      ],
    })

    expect(prisma.whatsAppContact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceUpdatedAt: new Date(1700000000 * 1000) }),
      }),
    )
  })
})
