import { ConfigService } from '@nestjs/config'
import { BotService } from './bot.service'

function createPrismaMock() {
  return {
    phoneNumber: { findFirst: jest.fn() },
    poliza: { findFirst: jest.fn(), update: jest.fn() },
    novedad: { findFirst: jest.fn(), create: jest.fn() },
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

  describe('requestPolicyCancellation', () => {
    beforeEach(() => {
      prisma.conversation.findFirst.mockResolvedValue({
        producerId: 2,
        waId: '5493410000000',
        sessionStartedAt: new Date(Date.now() - 60_000),
        clientLinkedAt: new Date(),
        client: { id: 5, dni: '12345678', firstName: 'Ana', lastName: 'Pérez', phone: null, deletedAt: null },
      })
      prisma.poliza.findFirst.mockResolvedValue({
        id: 9,
        certificado: 'ABC',
        producerCodeId: 8,
        vehiculo: { dominio: 'AA123BB' },
      })
      prisma.novedad.findFirst.mockResolvedValue(null)
      prisma.novedad.create.mockResolvedValue({ id: 17 })
      prisma.$transaction.mockImplementation(fn => fn(prisma))
    })

    it('creates a scoped request, leaves the policy unchanged and flags the conversation for the office', async () => {
      await expect(service.requestPolicyCancellation(3, 9)).resolves.toEqual({ id: 17 })
      expect(prisma.poliza.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 9, clientId: 5, producerId: 2, deletedAt: null } }),
      )
      expect(prisma.novedad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'baja_poliza',
            category: 'baja',
            producerId: 2,
            clientId: 5,
            refId: 3,
            body: expect.stringContaining('AA123BB'),
          }),
        }),
      )
      expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'pending' } })
      expect(prisma.poliza.update).not.toHaveBeenCalled()
      expect(prisma.novedad.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: { not: 'resolved' } }) }),
      )
      expect(prisma.novedad.findFirst.mock.calls[0][0].where).not.toHaveProperty('readAt')
    })

    it('rejects an unidentified client before looking up any policy', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ producerId: 2, client: null })
      await expect(service.requestPolicyCancellation(3, 9)).rejects.toThrow('identified client')
      expect(prisma.poliza.findFirst).not.toHaveBeenCalled()
    })

    it('rejects a policy outside the identified client and organization', async () => {
      prisma.poliza.findFirst.mockResolvedValue(null)
      await expect(service.requestPolicyCancellation(3, 9)).rejects.toThrow('not found')
      expect(prisma.novedad.create).not.toHaveBeenCalled()
    })

    it('rejects a third-party link made in an earlier session', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        producerId: 2,
        waId: '5493410000000',
        sessionStartedAt: new Date(),
        clientLinkedAt: new Date(Date.now() - 60 * 60_000),
        client: { id: 5, dni: '12345678', firstName: 'Ana', lastName: 'Pérez', phone: null, deletedAt: null },
      })
      await expect(service.requestPolicyCancellation(3, 9)).rejects.toThrow('identified client')
      expect(prisma.poliza.findFirst).not.toHaveBeenCalled()
    })

    it('reuses a pending notification on a retry', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 17 })
      await expect(service.requestPolicyCancellation(3, 9)).resolves.toEqual({ id: 17 })
      expect(prisma.novedad.create).not.toHaveBeenCalled()
    })
  })

  describe('getContext', () => {
    it('exposes the organization-wide bot switch', async () => {
      prisma.phoneNumber.findFirst.mockResolvedValue({
        producer: {
          id: 1,
          name: 'John',
          slug: 'john',
          botName: 'Nico',
          botEnabled: false,
          businessHours: null,
          systemPrompt: 'x',
          isActive: true,
        },
      })

      await expect(service.getContext('P1')).resolves.toEqual(
        expect.objectContaining({ producerId: 1, botEnabled: false }),
      )
    })
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

    describe('linked client', () => {
      const adriana = { id: 5, firstName: 'Adriana', lastName: 'Gómez', dni: '20111222', phone: '341156930749' }

      it('keeps a third-party link inside the session it was made in', async () => {
        const start = new Date(Date.now() - 60_000)
        prisma.conversation.findFirst.mockResolvedValue({
          id: 7,
          sessionStartedAt: start,
          lastMessageAt: new Date(),
          phoneNumberId: 'P1',
          clientLinkedAt: new Date(start.getTime() + 1_000),
          client: adriana,
        })

        const result = await service.getOrCreateConversation('P1', '5493413404951')

        expect(result.client).toEqual(adriana)
      })

      it('drops a third-party link once a new session starts', async () => {
        const old = new Date(Date.now() - 10 * 60_000)
        prisma.conversation.findFirst.mockResolvedValue({
          id: 7,
          sessionStartedAt: old,
          lastMessageAt: old,
          phoneNumberId: 'P1',
          clientLinkedAt: old,
          client: adriana,
        })

        const result = await service.getOrCreateConversation('P1', '5493413404951')

        expect(result.newSession).toBe(true)
        expect(result.client).toBeNull()
      })

      it('drops legacy links with no link time unless the phone matches', async () => {
        const recent = new Date()
        prisma.conversation.findFirst.mockResolvedValue({
          id: 7,
          sessionStartedAt: recent,
          lastMessageAt: recent,
          phoneNumberId: 'P1',
          clientLinkedAt: null,
          client: adriana,
        })

        await expect(service.getOrCreateConversation('P1', '5493413404951')).resolves.toMatchObject({ client: null })
        await expect(service.getOrCreateConversation('P1', '5493416930749')).resolves.toMatchObject({
          client: adriana,
        })
      })
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
        data: expect.objectContaining({ clientId: null, producerCodeId: null, clientLinkedAt: null }),
      })
    })
  })

  describe('recordAgentEcho', () => {
    beforeEach(() => {
      prisma.phoneNumber.findFirst.mockResolvedValue({
        producer: { id: 1, name: 'John', slug: 'john', systemPrompt: 'x', isActive: true },
      })
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, botPaused: false })
    })

    it('stores an app echo idempotently and pauses the conversation', async () => {
      const tx = {
        message: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx))

      const result = await service.recordAgentEcho({
        phoneNumberId: 'P1',
        waId: 'wa1',
        content: 'Te atiendo yo',
        waMessageId: 'wamid.1',
      })

      expect(tx.message.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ waMessageId: 'wamid.1' })],
          skipDuplicates: true,
        }),
      )
      expect(tx.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ botPaused: true }) }),
      )
      expect(result.created).toBe(true)
    })

    it('turns a retried wamid into a no-op', async () => {
      const tx = {
        message: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        conversation: { update: jest.fn() },
      }
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx))

      const result = await service.recordAgentEcho({
        phoneNumberId: 'P1',
        waId: 'wa1',
        content: 'Te atiendo yo',
        waMessageId: 'wamid.1',
      })

      expect(tx.conversation.update).not.toHaveBeenCalled()
      expect(result.created).toBe(false)
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
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ producer: { botEnabled: true } }),
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
        data: { lastMessageAt: created.createdAt, warnedAt: null, unreadCount: { increment: 1 } },
      })
      expect(result).toBe(created)
    })

    it('stores media metadata with the inbound message', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: null })
      const created = { id: 100, role: 'user', content: '[foto]', createdAt: new Date() }
      const tx = {
        message: { create: jest.fn().mockResolvedValue(created) },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx))
      const media = {
        url: '/uploads/siniestros/a.webp',
        originalName: 'a.webp',
        mimeType: 'image/webp',
        size: 42,
      }

      await service.saveMessage(7, { role: 'user', content: '[foto]', media } as any)

      expect(tx.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rawData: { media } }) }),
      )
    })

    it('records the sender’s WhatsApp profile name with an inbound message', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: null })
      const created = { id: 101, role: 'user', content: 'hola', createdAt: new Date() }
      const tx = {
        message: { create: jest.fn().mockResolvedValue(created) },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx))

      await service.saveMessage(7, { role: 'user', content: 'hola', contactName: ' John ' } as any)

      expect(tx.conversation.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ contactName: 'John' }),
      })
    })
  })

  describe('createSiniestro', () => {
    beforeEach(() => {
      prisma.conversation.findFirst.mockResolvedValue({
        producerId: 2,
        waId: '5493410000000',
        sessionStartedAt: new Date(Date.now() - 60_000),
        clientLinkedAt: new Date(),
        client: { id: 5, dni: '12345678', firstName: 'Ana', lastName: 'Pérez', phone: null, deletedAt: null },
      })
    })
    const dto = { polizaId: 9, tipo: 'auto', fecha: '2026-10-05', descripcion: 'Choque' }

    it('refuses a policy with a rejected debit', async () => {
      prisma.poliza.findFirst.mockResolvedValue({
        id: 9,
        certificado: 'ABC',
        company: 'Triunfo',
        producerCodeId: 8,
        cuotas: [{ status: 'rejected', dueDate: new Date() }],
      })
      await expect(service.createSiniestro(3, dto)).rejects.toThrow('pago rechazado')
    })

    it('refuses a policy with overdue installments', async () => {
      prisma.poliza.findFirst.mockResolvedValue({
        id: 9,
        certificado: 'ABC',
        company: 'Triunfo',
        producerCodeId: 8,
        cuotas: [{ status: 'overdue', dueDate: new Date(Date.now() - 20 * 86_400_000) }],
      })
      await expect(service.createSiniestro(3, dto)).rejects.toThrow('cuotas vencidas')
    })

    it('only looks up policies in force', async () => {
      prisma.poliza.findFirst.mockResolvedValue(null)
      await expect(service.createSiniestro(3, dto)).rejects.toThrow('not in force')
      expect(prisma.poliza.findFirst.mock.calls[0][0].where.AND[1]).toHaveProperty('vigenciaHasta')
    })
  })
})
