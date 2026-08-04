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
    businessClosure: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  }
}

describe('BotService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: BotService

  beforeEach(() => {
    prisma = createPrismaMock()
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService
    // triunfo/mail/novedades are unused by the methods under test; usage is only
    // consulted for the LLM budget flag, which these tests don't exercise.
    const usage = { isLlmEnabled: jest.fn().mockResolvedValue(true) }
    service = new BotService(prisma as any, {} as any, {} as any, {} as any, usage as any, config)
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
    beforeEach(() => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: 3 })
    })

    it('clears the session boundary, activity and warning, keeping the client', async () => {
      // The "finalizar" path: a normal goodbye still knows who the client is.
      await service.resetSession(7)

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { sessionStartedAt: expect.any(Date), lastMessageAt: null, warnedAt: null, flowState: null },
      })
    })

    it('also unlinks the client on a full reset (/reset)', async () => {
      await service.resetSession(7, true)

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ clientId: null, producerCodeId: null }),
      })
    })
  })

  describe('claimPendingWarnings', () => {
    /** An always-open week, so the schedule is not what the assertion turns on. */
    const alwaysOpen = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [{ from: '00:00', to: '23:59' }]]),
    )
    /** Closed every day. */
    const alwaysClosed = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, []]))
    const candidateWith = (businessHours: unknown) => ({
      id: 7,
      waId: 'wa1',
      phoneNumberId: 'P1',
      producer: { id: 1, businessHours },
    })

    it('claims the conversation and returns it so the goodbye is sent', async () => {
      prisma.conversation.findMany.mockResolvedValue([candidateWith(alwaysOpen)])

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [7] } },
          data: { warnedAt: expect.any(Date) },
        }),
      )
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({ conversationId: 7, waId: 'wa1', phoneNumberId: 'P1', isOpenNow: true }),
      )
    })

    it('still sends the goodbye outside office hours, flagged as closed', async () => {
      // The session really ended, and the menu is still tappable on the user's
      // screen — staying silent is what left them with a puzzling greeting.
      prisma.conversation.findMany.mockResolvedValue([candidateWith(alwaysClosed)])

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalled()
      expect(result).toHaveLength(1)
      expect(result[0].isOpenNow).toBe(false)
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
