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
  }
}

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
      await expect(service.clearAll(5, [10])).resolves.toEqual({ clearedCount: 15 })
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] },
        data: { deletedAt: expect.any(Date) },
      })
      expect(prisma.contactLead.updateMany).not.toHaveBeenCalled()
      expect(prisma.quoteRequest.updateMany).not.toHaveBeenCalled()
    })

    it('returns zero when there are no accessible notifications', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.clearAll(5, [])).resolves.toEqual({ clearedCount: 0 })
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [] } }, { producerCodeId: null }] },
        }),
      )
    })

    it('reports database failures without returning a false success', async () => {
      prisma.notification.updateMany.mockRejectedValue(new Error('database unavailable'))
      await expect(service.clearAll(5, [10])).rejects.toThrow('database unavailable')
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
    it('orders unread first then newest, and applies pagination defaults', async () => {
      prisma.notification.count.mockResolvedValue(1)
      prisma.notification.findMany.mockResolvedValue([{ id: 8 }])

      const result = await service.listForAdmin(5, [10], {})

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            producerId: 5,
            deletedAt: null,
            OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
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

      await service.listForAdmin(5, [10], { type: NovedadType.HANDOFF, unread: true })

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
          type: 'handoff',
          readAt: null,
        },
      })
    })

    it('filters by clientId and by a DNI/name search against the linked client', async () => {
      prisma.notification.count.mockResolvedValue(0)
      prisma.notification.findMany.mockResolvedValue([])

      await service.listForAdmin(5, [10], { clientId: 3, search: '30123' })

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
          clientId: 3,
          AND: [
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

      const stats = await service.getStats(5, [10])

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
      await service.listForAdmin(5, [10], {
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
        OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
        createdAt: { gt: new Date('2026-09-30T20:00:00Z') },
      })
      expect(where).not.toHaveProperty('readAt')
      expect(where.AND).toHaveLength(1)
    })

    it('rejects changes outside the tenant/scope', async () => {
      await expect(service.updateMatter(8, 5, [10], { status: MatterStatus.RESOLVED })).rejects.toBeInstanceOf(
        NotFoundException,
      )
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
      await service.updateMatter(8, 5, [10], { status: MatterStatus.RESOLVED })
      expect(prisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'resolved', resolvedAt: expect.any(Date) } }),
      )
      await service.updateMatter(8, 5, [10], { status: MatterStatus.PENDING })
      expect(prisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'pending', resolvedAt: null } }),
      )
    })

    it('updates the quote request in the same transaction', async () => {
      prisma.notification.findFirst.mockResolvedValue({ type: 'lead', refId: 21 })
      await service.updateMatter(8, 5, [10], { status: MatterStatus.IN_PROGRESS })
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

      await expect(service.markRead(8, 5, [10])).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.notification.update).not.toHaveBeenCalled()
    })

    it('stamps readAt the first time', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 8, readAt: null })
      prisma.notification.update.mockResolvedValue({ id: 8, readAt: new Date() })

      await service.markRead(8, 5, [10])

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 }, data: { readAt: expect.any(Date) } }),
      )
    })

    it('is idempotent when the novedad is already read', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 8, readAt: new Date() })
      prisma.notification.findFirstOrThrow.mockResolvedValue({ id: 8 })

      await service.markRead(8, 5, [10])

      expect(prisma.notification.update).not.toHaveBeenCalled()
      expect(prisma.notification.findFirstOrThrow).toHaveBeenCalled()
    })
  })

  describe('markAllRead', () => {
    it('marks all unread, optionally scoped to a type', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 })

      const result = await service.markAllRead(5, [10], NovedadType.SINIESTRO)

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
})
