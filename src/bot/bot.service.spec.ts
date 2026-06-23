import { ConfigService } from '@nestjs/config'
import { BotService } from './bot.service'

function createPrismaMock() {
  return {
    phoneNumber: { findFirst: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    message: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  }
}

describe('BotService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: BotService

  beforeEach(() => {
    prisma = createPrismaMock()
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService
    // triunfo/mail/novedades are unused by the methods under test.
    service = new BotService(prisma as any, {} as any, {} as any, {} as any, config)
  })

  describe('getOrCreateConversation', () => {
    beforeEach(() => {
      prisma.phoneNumber.findFirst.mockResolvedValue({
        producer: { id: 1, name: 'John', slug: 'john', systemPrompt: 'x', isActive: true },
      })
      prisma.message.findMany.mockResolvedValue([])
    })

    it('starts a new session when the last message is older than the timeout', async () => {
      const old = new Date(Date.now() - 10 * 60_000) // 10 min ago (default timeout is 5)
      prisma.conversation.findFirst.mockResolvedValue({
        id: 7,
        sessionStartedAt: old,
        lastMessageAt: old,
        phoneNumberId: 'P1',
        client: null,
      })

      const result = await service.getOrCreateConversation('P1', 'wa1')

      expect(result.newSession).toBe(true)
      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: expect.objectContaining({ sessionStartedAt: expect.any(Date) }),
        }),
      )
    })

    it('keeps the session when activity is recent', async () => {
      const recent = new Date()
      prisma.conversation.findFirst.mockResolvedValue({
        id: 7,
        sessionStartedAt: recent,
        lastMessageAt: recent,
        phoneNumberId: 'P1',
        client: null,
      })

      const result = await service.getOrCreateConversation('P1', 'wa1')

      expect(result.newSession).toBe(false)
      expect(prisma.conversation.update).not.toHaveBeenCalled()
    })

    it('backfills the originating phone number on legacy rows', async () => {
      const recent = new Date()
      prisma.conversation.findFirst.mockResolvedValue({
        id: 7,
        sessionStartedAt: recent,
        lastMessageAt: recent,
        phoneNumberId: null, // legacy row created before the column existed
        client: null,
      })

      await service.getOrCreateConversation('P1', 'wa1')

      expect(prisma.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phoneNumberId: 'P1' }) }),
      )
    })
  })

  describe('resetSession', () => {
    it('clears the session boundary, activity and warning (keeping the client)', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: 3 })

      await service.resetSession(7)

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { sessionStartedAt: expect.any(Date), lastMessageAt: null, warnedAt: null, flowState: null },
      })
    })
  })

  describe('claimPendingWarnings', () => {
    const candidate = { id: 7, waId: 'wa1', phoneNumberId: 'P1' }

    it('claims and returns the conversations to warn during office hours', async () => {
      prisma.conversation.findMany.mockResolvedValue([candidate])
      jest.spyOn(service as any, 'isWithinBusinessHours').mockReturnValue(true)

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [7] } },
          data: { warnedAt: expect.any(Date) },
        }),
      )
      expect(result).toEqual([{ conversationId: 7, waId: 'wa1', phoneNumberId: 'P1' }])
    })

    it('finalizes silently outside office hours (claims but returns nothing)', async () => {
      prisma.conversation.findMany.mockResolvedValue([candidate])
      jest.spyOn(service as any, 'isWithinBusinessHours').mockReturnValue(false)

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it('does nothing when no conversation is idle', async () => {
      prisma.conversation.findMany.mockResolvedValue([])

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })
  })

  describe('saveMessage', () => {
    it('persists the message and refreshes activity atomically', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: null })
      const created = { id: 99, role: 'user', content: 'hola', createdAt: new Date() }
      const tx = {
        message: { create: jest.fn().mockResolvedValue(created) },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx))

      const result = await service.saveMessage(7, { role: 'user', content: 'hola' } as any)

      expect(tx.message.create).toHaveBeenCalled()
      expect(tx.conversation.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { lastMessageAt: created.createdAt, warnedAt: null },
      })
      expect(result).toBe(created)
    })
  })
})
