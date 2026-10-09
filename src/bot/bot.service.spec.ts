import { ConfigService } from '@nestjs/config'
import { BotService } from './bot.service'

// Image optimisation touches the disk; these tests only care where a photo goes.
jest.mock('../siniestros/siniestro-upload.config', () => ({
  ...jest.requireActual('../siniestros/siniestro-upload.config'),
  toStoredAdjuntos: jest.fn().mockResolvedValue([{ url: '/uploads/siniestros/a.jpg' }]),
}))

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
    message: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    siniestro: { findFirst: jest.fn(), update: jest.fn() },
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

    it('tells the bot what a person from the office said last, even in an earlier session', async () => {
      const old = new Date(Date.now() - 3 * 60 * 60_000)
      prisma.conversation.findFirst.mockResolvedValue({
        id: 7,
        sessionStartedAt: old,
        lastMessageAt: old,
        phoneNumberId: 'P1',
        client: null,
      })
      prisma.message.findFirst
        .mockResolvedValueOnce({ content: 'Pasame las fotos que tenés', createdAt: old })
        .mockResolvedValueOnce(null) // the bot has not spoken since

      const result = await service.getOrCreateConversation('P1', 'wa1')

      expect(result.newSession).toBe(true)
      expect(result.lastHumanReply).toEqual({ content: 'Pasame las fotos que tenés', createdAt: old.toISOString() })
      expect(result.previousActivityAt).toBe(old.toISOString())
      const where = prisma.message.findFirst.mock.calls[0][0].where
      expect(where.OR).toEqual([{ role: 'agent' }, { source: 'app_echo' }])
      // Looks back a day, not just into the current session.
      expect(Date.now() - (where.createdAt.gte as Date).getTime()).toBeGreaterThan(23 * 60 * 60_000)
    })

    it('drops the human reply once the bot answered after it', async () => {
      const old = new Date(Date.now() - 3 * 60 * 60_000)
      prisma.conversation.findFirst.mockResolvedValue({
        id: 7,
        sessionStartedAt: old,
        lastMessageAt: old,
        phoneNumberId: 'P1',
        client: null,
      })
      prisma.message.findFirst
        .mockResolvedValueOnce({ content: 'Pasame las fotos', createdAt: old })
        .mockResolvedValueOnce({ id: 90 })

      const result = await service.getOrCreateConversation('P1', 'wa1')

      expect(result.lastHumanReply).toBeNull()
      expect(prisma.message.findFirst.mock.calls[1][0].where).toMatchObject({
        role: 'assistant',
        source: 'live',
        createdAt: { gt: old },
      })
    })

    it('reports no previous activity for a brand-new chat', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)
      prisma.conversation.create.mockResolvedValue({
        id: 8,
        sessionStartedAt: new Date(),
        lastMessageAt: null,
        phoneNumberId: 'P1',
        client: null,
      })

      const result = await service.getOrCreateConversation('P1', 'wa2')

      expect(result).toMatchObject({ lastHumanReply: null, previousActivityAt: null })
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
    // Default session timeout is 5 minutes: 6 minutes ago just crossed it.
    const justIdle = () => new Date(Date.now() - 6 * 60_000)
    const candidateWith = (businessHours: unknown, overrides: Record<string, unknown> = {}) => ({
      id: 7,
      waId: 'wa1',
      phoneNumberId: 'P1',
      botPaused: false,
      lastMessageAt: justIdle(),
      messages: [{ role: 'assistant' }],
      producer: { id: 1, businessHours },
      ...overrides,
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

    it.each([
      ['piled up while the bot was off (idle for days)', { lastMessageAt: new Date(Date.now() - 3 * 86_400_000) }],
      ['an advisor has the chat', { botPaused: true }],
      ['the customer wrote last and got no answer', { messages: [{ role: 'user' }] }],
      ['an advisor wrote last', { messages: [{ role: 'agent' }] }],
    ])('finalizes silently, without a goodbye, a chat that %s', async (_case, overrides) => {
      prisma.conversation.findMany.mockResolvedValue([candidateWith(alwaysOpen, overrides)])

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [7] } }, data: { warnedAt: expect.any(Date) } }),
      )
      expect(result).toEqual([])
    })

    it('only says goodbye to the chats that qualify when re-enabling sweeps a backlog', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        candidateWith(alwaysOpen, { id: 1, waId: 'reciente' }),
        candidateWith(alwaysOpen, { id: 2, waId: 'viejo', lastMessageAt: new Date(Date.now() - 2 * 3_600_000) }),
        candidateWith(alwaysOpen, { id: 3, waId: 'sin-respuesta', messages: [{ role: 'user' }] }),
      ])

      const result = await service.claimPendingWarnings()

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [1, 2, 3] } } }),
      )
      expect(result.map(r => r.waId)).toEqual(['reciente'])
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

    it('only looks up policies in force', async () => {
      prisma.poliza.findFirst.mockResolvedValue(null)
      await expect(service.createSiniestro(3, dto)).rejects.toThrow('not in force')
      expect(prisma.poliza.findFirst.mock.calls[0][0].where.AND[1]).toHaveProperty('vigenciaHasta')
    })
  })

  describe('storeAudio', () => {
    const file = {
      filename: '1791230000000-123.ogg',
      originalname: 'audio.ogg',
      mimetype: 'audio/ogg',
      size: 4200,
    } as Express.Multer.File

    it('returns the protected URL of the stored voice note', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 7, producerId: 1, clientId: null })

      await expect(service.storeAudio(7, file)).resolves.toEqual({
        filename: '1791230000000-123.ogg',
        originalName: 'audio.ogg',
        url: '/uploads/audios/1791230000000-123.ogg',
        mimeType: 'audio/ogg',
        size: 4200,
      })
    })

    it('rejects a request without a file or for an unknown conversation', async () => {
      await expect(service.storeAudio(7, undefined)).rejects.toThrow('No audio received')
      prisma.conversation.findFirst.mockResolvedValue(null)
      await expect(service.storeAudio(99, file)).rejects.toThrow('not found')
    })
  })
})

describe('BotService.attachAdjuntos', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: BotService
  const photo = [{ originalname: 'a.jpg' }] as unknown as Express.Multer.File[]

  beforeEach(() => {
    prisma = createPrismaMock()
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService
    const usage = { isLlmEnabled: jest.fn().mockResolvedValue(true) }
    service = new BotService(prisma as any, {} as any, {} as any, {} as any, usage as any, config)
    prisma.conversation.findFirst.mockResolvedValue({ id: 3, producerId: 1, clientId: 5 })
    prisma.siniestro.findFirst.mockResolvedValue(null)
  })

  it('only joins a loose photo to a claim filed in the last 48 hours', async () => {
    const result = await service.attachAdjuntos(3, photo)

    expect(result.attached).toBe(false)
    const where = prisma.siniestro.findFirst.mock.calls[0][0].where
    const since = where.createdAt.gte as Date
    expect(Date.now() - since.getTime()).toBeGreaterThan(47 * 60 * 60_000)
    expect(Date.now() - since.getTime()).toBeLessThan(49 * 60 * 60_000)
  })

  it('attaches a guided claim photo to the open claim whatever its age', async () => {
    prisma.siniestro.findFirst.mockResolvedValue({ id: 9, adjuntos: [] })

    const result = await service.attachAdjuntos(3, photo, 'tarjeta_verde')

    expect(result).toMatchObject({ siniestroId: 9, attached: true })
    expect(prisma.siniestro.findFirst.mock.calls[0][0].where).not.toHaveProperty('createdAt')
  })
})
