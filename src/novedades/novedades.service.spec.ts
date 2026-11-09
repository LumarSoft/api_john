import { NotFoundException } from '@nestjs/common'
import { NovedadesService } from './novedades.service'
import { NovedadType, MatterCategory, MatterStatus } from './dto/list-novedades.dto'

function createPrismaMock() {
  return {
    notification: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    // Resolves the array form used by listForAdmin / getStats.
    $transaction: jest.fn(),
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    contactLead: { updateMany: jest.fn() },
    quoteRequest: { updateMany: jest.fn() },
    conversation: { findMany: jest.fn().mockResolvedValue([]) },
  }
}

/** A SuperAdmin of code 10: its novedades plus the unattributed ones. */
const SUPERADMIN_CHATS = { codeIds: [10], ownNumbers: null }

describe('NovedadesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: NovedadesService

  beforeEach(() => {
    prisma = createPrismaMock()
    prisma.$transaction.mockImplementation(ops => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops)))
    service = new NovedadesService(prisma as never)
  })

  describe('clearAll', () => {
    it('soft deletes only accessible notifications without changing business records', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 15 })
      await expect(service.clearAll(5, SUPERADMIN_CHATS)).resolves.toEqual({ clearedCount: 15 })
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] },
        data: { deletedAt: expect.any(Date) },
      })
      expect(prisma.contactLead.updateMany).not.toHaveBeenCalled()
      expect(prisma.quoteRequest.updateMany).not.toHaveBeenCalled()
    })

    it('returns zero when there are no accessible notifications', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.clearAll(5, { codeIds: [], ownNumbers: null })).resolves.toEqual({ clearedCount: 0 })
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [] } }, { producerCodeId: null }] },
        }),
      )
    })

    it('reports database failures without returning a false success', async () => {
      prisma.notification.updateMany.mockRejectedValue(new Error('database unavailable'))
      await expect(service.clearAll(5, SUPERADMIN_CHATS)).rejects.toThrow('database unavailable')
    })
  })

  describe('emission', () => {
    it('records a siniestro novedad with a denormalized title, body and client', async () => {
      prisma.notification.create.mockResolvedValue({ id: 1 })

      await service.recordSiniestro(5, {
        siniestroId: 6,
        clientId: 3,
        clienteNombre: 'Ana Gómez',
        descripcion: 'choque',
      })

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          producerId: 5,
          type: 'siniestro',
          category: 'siniestro',
          refId: 6,
          clientId: 3,
          producerCodeId: null,
          phoneNumberId: null,
          title: 'Nuevo siniestro · Ana Gómez',
          body: 'choque',
        },
      })
    })

    it('records a handoff novedad with no body (client may be null)', async () => {
      prisma.notification.create.mockResolvedValue({ id: 2 })

      await service.recordHandoff(5, { conversationId: 1, clientId: null, clienteNombre: 'Ana Gómez' })

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          producerId: 5,
          type: 'handoff',
          category: 'other',
          refId: 1,
          clientId: null,
          producerCodeId: null,
          phoneNumberId: null,
          title: 'Pedido de asesor · Ana Gómez',
          body: null,
        },
      })
    })

    it('never throws if persisting the novedad fails (must not break the caller)', async () => {
      prisma.notification.create.mockRejectedValue(new Error('db down'))

      await expect(
        service.recordSiniestro(5, { siniestroId: 6, clientId: 3, clienteNombre: 'Ana', descripcion: 'x' }),
      ).resolves.toBeUndefined()
    })
  })

  describe('listForAdmin', () => {
    it('shows an admin only what came through their own numbers, within their codes', async () => {
      prisma.$transaction.mockResolvedValue([0, []])

      await service.listForAdmin(5, { codeIds: [4], ownNumbers: ['BRANCH'], defaultNumber: 'OFFICE' }, {})

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            producerId: 5,
            AND: [
              {
                AND: [
                  { OR: [{ producerCodeId: { in: [4] } }, { producerCodeId: null }] },
                  { phoneNumberId: { in: ['BRANCH'] } },
                ],
              },
            ],
          }),
        }),
      )
    })

    it("keeps an admin's scope when they search: the search goes beside it, never over it", async () => {
      prisma.$transaction.mockResolvedValue([0, []])

      await service.listForAdmin(
        5,
        { codeIds: [4], ownNumbers: ['BRANCH'], defaultNumber: 'OFFICE' },
        { search: 'Pérez' },
      )

      const where = prisma.notification.findMany.mock.calls[0][0].where
      expect(where.AND).toHaveLength(2)
      expect(where.AND[0]).toEqual({
        AND: [
          { OR: [{ producerCodeId: { in: [4] } }, { producerCodeId: null }] },
          { phoneNumberId: { in: ['BRANCH'] } },
        ],
      })
      expect(where.AND[1].OR).toEqual(expect.arrayContaining([{ title: { contains: 'Pérez' } }]))
    })

    it("counts what came through no number as the office's, the default number", async () => {
      prisma.$transaction.mockResolvedValue([0, []])

      await service.listForAdmin(
        5,
        { codeIds: [10], ownNumbers: null, filterNumber: 'OFFICE', defaultNumber: 'OFFICE' },
        {},
      )

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              {
                AND: [
                  { OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] },
                  { OR: [{ phoneNumberId: { in: ['OFFICE'] } }, { phoneNumberId: null }] },
                ],
              },
            ],
          }),
        }),
      )
    })

    it('orders unread first then newest, and applies pagination defaults', async () => {
      prisma.notification.count.mockResolvedValue(1)
      prisma.notification.findMany.mockResolvedValue([{ id: 8 }])

      const result = await service.listForAdmin(5, SUPERADMIN_CHATS, {})

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            producerId: 5,
            deletedAt: null,
            AND: [{ OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 20,
        }),
      )
      expect(result).toEqual({ data: [{ id: 8 }], total: 1, page: 1, pageSize: 20, totalPages: 1 })
    })

    it('filters by type and unread when requested', async () => {
      prisma.notification.count.mockResolvedValue(0)
      prisma.notification.findMany.mockResolvedValue([])

      await service.listForAdmin(5, SUPERADMIN_CHATS, { type: NovedadType.HANDOFF, unread: true })

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          AND: [{ OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] }],
          type: 'handoff',
          readAt: null,
        },
      })
    })

    it('filters by clientId and by a DNI/name search against the linked client', async () => {
      prisma.notification.count.mockResolvedValue(0)
      prisma.notification.findMany.mockResolvedValue([])

      await service.listForAdmin(5, SUPERADMIN_CHATS, { clientId: 3, search: '30123' })

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          clientId: 3,
          AND: [
            { OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] },
            {
              OR: [
                { title: { contains: '30123' } },
                { body: { contains: '30123' } },
                {
                  client: {
                    OR: [
                      { firstName: { contains: '30123' } },
                      { lastName: { contains: '30123' } },
                      { dni: { contains: '30123' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      })
    })
  })

  describe('getStats', () => {
    it('returns unread counters by category', async () => {
      prisma.notification.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(2)

      const stats = await service.getStats(5, SUPERADMIN_CHATS)

      expect(stats).toEqual({
        unreadTotal: 3,
        unreadClaims: 2,
        unreadHandoff: 1,
        unreadCancellations: 0,
        actionableTotal: 12,
        actionableByCategory: { baja: 2, pagos: 2, cotizacion: 2, siniestro: 2, documentos: 2, other: 2 },
      })
    })
  })

  describe('matter queue', () => {
    it('keeps actionable filtering independent of read state and preserves code scope with search', async () => {
      prisma.notification.count.mockResolvedValue(0)
      prisma.notification.findMany.mockResolvedValue([])
      await service.listForAdmin(5, SUPERADMIN_CHATS, {
        actionable: true,
        category: MatterCategory.BAJA,
        since: '2026-09-30T20:00:00Z',
        search: 'cancelar',
      })
      const where = prisma.notification.count.mock.calls[0][0].where
      expect(where).toMatchObject({
        producerId: 5,
        category: 'baja',
        status: { not: 'resolved' },
        createdAt: { gt: new Date('2026-09-30T20:00:00Z') },
      })
      expect(where).not.toHaveProperty('readAt')
      expect(where.AND).toHaveLength(2)
      expect(where.AND[0]).toEqual({ OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] })
    })

    it('rejects changes outside the tenant/scope', async () => {
      await expect(
        service.updateMatter(8, 5, SUPERADMIN_CHATS, { status: MatterStatus.RESOLVED }),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 8,
            producerId: 5,
            deletedAt: null,
            OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
          },
        }),
      )
      expect(prisma.notification.update).not.toHaveBeenCalled()
    })

    it('resolves and reopens without altering read state', async () => {
      prisma.notification.findFirst.mockResolvedValue({ type: 'handoff', refId: 1 })
      await service.updateMatter(8, 5, SUPERADMIN_CHATS, { status: MatterStatus.RESOLVED })
      expect(prisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'resolved', resolvedAt: expect.any(Date) } }),
      )
      await service.updateMatter(8, 5, SUPERADMIN_CHATS, { status: MatterStatus.PENDING })
      expect(prisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'pending', resolvedAt: null } }),
      )
    })

    it('updates the quote request in the same transaction', async () => {
      prisma.notification.findFirst.mockResolvedValue({ type: 'lead', refId: 21 })
      await service.updateMatter(8, 5, SUPERADMIN_CHATS, { status: MatterStatus.IN_PROGRESS })
      expect(prisma.contactLead.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 21, producerId: 5 }),
          data: { status: 'CONTACTED' },
        }),
      )
    })

    it('stores and classifies the handoff reason', async () => {
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: null,
        clienteNombre: 'Ana',
        reason: 'Quiero dar de baja mi póliza',
      })
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: 'baja', body: 'Quiero dar de baja mi póliza' }),
        }),
      )
    })

    it('avoids exact repeats but preserves a different matter in the same chat', async () => {
      const input = { conversationId: 1, clientId: null, clienteNombre: 'Ana' }
      prisma.notification.findFirst.mockResolvedValueOnce({ id: 8 })
      await service.recordHandoff(5, { ...input, reason: 'ya pagué' })
      expect(prisma.notification.create).not.toHaveBeenCalled()
      // No exact repeat; the open matter is about payments, the new one a cancellation.
      prisma.notification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 8, body: 'ya pagué', category: 'pagos' })
      await service.recordHandoff(5, { ...input, reason: 'quiero dar de baja mi póliza' })
      expect(prisma.notification.update).not.toHaveBeenCalled()
      expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    })

    it('adds what the customer says next to the open matter of the same kind', async () => {
      prisma.notification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 8, body: 'Pide los comprobantes de pago', category: 'pagos' })
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: null,
        clienteNombre: 'Ana',
        reason: 'Consultar por certificados de pago',
      })
      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(prisma.notification.findFirst.mock.calls[1][0].where).toEqual(
        expect.objectContaining({ refId: 1, status: { not: 'resolved' }, createdAt: { gte: expect.any(Date) } }),
      )
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 8 },
        data: {
          body: 'Pide los comprobantes de pago\n\nConsultar por certificados de pago',
          category: 'pagos',
          status: 'pending',
          readAt: null,
          createdAt: expect.any(Date),
        },
      })
    })

    it('gives a generic open matter the kind of the reason that follows it', async () => {
      prisma.notification.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 8,
        body: 'Pidió hablar con un asesor. Todavía no contó el motivo.',
        category: 'other',
      })
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: null,
        clienteNombre: 'Ana',
        reason: 'Motivo: quiero dar de baja mi póliza',
      })
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ category: 'baja' }) }),
      )
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('does not add an empty request to an open matter', async () => {
      prisma.notification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 8, body: 'Pide cupones', category: 'pagos' })
      await service.recordHandoff(5, { conversationId: 1, clientId: null, clienteNombre: 'Ana' })
      expect(prisma.notification.update).not.toHaveBeenCalled()
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('marks a claim the bot refused to file and files it under siniestros', async () => {
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: 3,
        clienteNombre: 'Ana',
        reason: 'Denuncia de siniestro no registrada: la póliza 123 figura con saldo vencido impago.',
        blockedClaimReason: 'REJECTED_PAYMENT',
      })
      // The explicit field wins over the words of the reason.
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: 'siniestro', blockedClaimReason: 'REJECTED_PAYMENT' }),
      })
    })

    it('reads the stopped claim from the reason when an older bot sends no field', async () => {
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: 3,
        clienteNombre: 'Ana',
        reason: 'Denuncia de siniestro no registrada: el cliente no tiene pólizas vigentes.',
      })
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: 'siniestro', blockedClaimReason: 'NO_POLICY' }),
      })
    })

    it('leaves an ordinary request unmarked', async () => {
      await service.recordHandoff(5, { conversationId: 1, clientId: null, clienteNombre: 'Ana', reason: 'ya pagué' })
      expect(prisma.notification.create.mock.calls[0][0].data).not.toHaveProperty('blockedClaimReason')
    })

    it('carries the mark over to the open request it joins', async () => {
      prisma.notification.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 8,
        body: 'Pidió hablar con un asesor. Todavía no contó el motivo.',
        category: 'other',
      })
      await service.recordHandoff(5, {
        conversationId: 1,
        clientId: 3,
        clienteNombre: 'Ana',
        reason: 'Denuncia de siniestro no registrada: la póliza 123 figura con un cobro rechazado.',
        blockedClaimReason: 'REJECTED_PAYMENT',
      })
      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 8 },
          data: expect.objectContaining({ category: 'siniestro', blockedClaimReason: 'REJECTED_PAYMENT' }),
        }),
      )
    })

    it('lists the open stopped claims of the given chats, newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { refId: 7, blockedClaimReason: 'OVERDUE_INSTALLMENTS' },
        { refId: 7, blockedClaimReason: 'NO_POLICY' },
        { refId: 9, blockedClaimReason: 'NO_POLICY' },
      ])
      const result = await service.blockedClaimsByConversation(5, [7, 8, 9])
      expect(result).toEqual(
        new Map([
          [7, 'OVERDUE_INSTALLMENTS'],
          [9, 'NO_POLICY'],
        ]),
      )
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            producerId: 5,
            type: 'handoff',
            refId: { in: [7, 8, 9] },
            blockedClaimReason: { not: null },
            status: { not: 'resolved' },
            deletedAt: null,
          }),
        }),
      )
      await expect(service.blockedClaimsByConversation(5, [])).resolves.toEqual(new Map())
      expect(prisma.notification.findMany).toHaveBeenCalledTimes(1)
    })

    it('refreshes a resubmitted quote instead of duplicating its matter', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 8 })
      await service.recordQuote(5, { type: NovedadType.SOLICITUD, refId: 21, name: 'Ana', summary: 'Eligió B1' })
      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 8 },
          data: expect.objectContaining({ status: 'pending', readAt: null, resolvedAt: null }),
        }),
      )
    })

    it('returns the previous visit before advancing its timestamp', async () => {
      const previous = new Date('2026-09-29T12:00:00Z')
      prisma.user.findUniqueOrThrow.mockResolvedValue({ lastNotificationsVisitAt: previous })
      const result = await service.registerVisit(3)
      expect(result.previousVisitAt).toEqual(previous)
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { lastNotificationsVisitAt: result.visitedAt },
      })
    })
  })

  describe('markRead', () => {
    it('throws 404 when the novedad is not in this tenant', async () => {
      prisma.notification.findFirst.mockResolvedValue(null)

      await expect(service.markRead(8, 5, SUPERADMIN_CHATS)).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.notification.update).not.toHaveBeenCalled()
    })

    it('stamps readAt the first time', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 8, readAt: null })
      prisma.notification.update.mockResolvedValue({ id: 8, readAt: new Date() })

      await service.markRead(8, 5, SUPERADMIN_CHATS)

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 }, data: { readAt: expect.any(Date) } }),
      )
    })

    it('is idempotent when the novedad is already read', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 8, readAt: new Date() })
      prisma.notification.findFirstOrThrow.mockResolvedValue({ id: 8 })

      await service.markRead(8, 5, SUPERADMIN_CHATS)

      expect(prisma.notification.update).not.toHaveBeenCalled()
      expect(prisma.notification.findFirstOrThrow).toHaveBeenCalled()
    })
  })

  describe('markAllRead', () => {
    it('marks all unread, optionally scoped to a type', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 })

      const result = await service.markAllRead(5, SUPERADMIN_CHATS, NovedadType.SINIESTRO)

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          readAt: null,
          OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
          type: 'siniestro',
        },
        data: { readAt: expect.any(Date) },
      })
      expect(result).toEqual({ updated: 4 })
    })
  })

  describe('chat matters answered by the office', () => {
    it('moves pending requests and cancellations of the chat to in progress once the office writes', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 2 })
      const answeredAt = new Date('2026-10-22T15:00:00Z')
      await expect(service.markConversationAnswered(7, answeredAt)).resolves.toBe(2)
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          type: { in: ['handoff', 'baja_poliza'] },
          refId: 7,
          status: 'pending',
          createdAt: { lte: answeredAt },
          deletedAt: null,
        },
        data: { status: 'in_progress' },
      })
    })

    it('resolves only what the office was handling when the chat goes back to the bot', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 })
      await expect(service.resolveAnsweredMatters(7)).resolves.toBe(1)
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { type: { in: ['handoff', 'baja_poliza'] }, refId: 7, status: 'in_progress', deletedAt: null },
        data: { status: 'resolved', resolvedAt: expect.any(Date) },
      })
    })

    it('never throws into the chat path', async () => {
      prisma.notification.updateMany.mockRejectedValue(new Error('db down'))
      await expect(service.markConversationAnswered(7)).resolves.toBe(0)
      await expect(service.resolveAnsweredMatters(7)).resolves.toBe(0)
    })
  })
})
