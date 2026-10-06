import { NotFoundException } from '@nestjs/common'
import { NovedadesService } from './novedades.service'
import { NovedadType, MatterCategory, MatterStatus } from './dto/list-novedades.dto'

function createPrismaMock() {
  return {
    novedad: {
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
    solicitud: { updateMany: jest.fn() },
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
      prisma.novedad.updateMany.mockResolvedValue({ count: 15 })
      await expect(service.clearAll(5, [10])).resolves.toEqual({ clearedCount: 15 })
      expect(prisma.novedad.updateMany).toHaveBeenCalledWith({
        where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }] },
        data: { deletedAt: expect.any(Date) },
      })
      expect(prisma.contactLead.updateMany).not.toHaveBeenCalled()
      expect(prisma.solicitud.updateMany).not.toHaveBeenCalled()
    })

    it('returns zero when there are no accessible notifications', async () => {
      prisma.novedad.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.clearAll(5, [])).resolves.toEqual({ clearedCount: 0 })
      expect(prisma.novedad.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { producerId: 5, deletedAt: null, OR: [{ producerCodeId: { in: [] } }, { producerCodeId: null }] },
        }),
      )
    })

    it('reports database failures without returning a false success', async () => {
      prisma.novedad.updateMany.mockRejectedValue(new Error('database unavailable'))
      await expect(service.clearAll(5, [10])).rejects.toThrow('database unavailable')
    })
  })

  describe('emission', () => {
    it('records a siniestro novedad with a denormalized title, body and client', async () => {
      prisma.novedad.create.mockResolvedValue({ id: 1 })

      await service.recordSiniestro(5, {
        siniestroId: 6,
        clientId: 3,
        clienteNombre: 'Ana Gómez',
        descripcion: 'choque',
      })

      expect(prisma.novedad.create).toHaveBeenCalledWith({
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
      prisma.novedad.create.mockResolvedValue({ id: 2 })

      await service.recordHandoff(5, { conversationId: 1, clientId: null, clienteNombre: 'Ana Gómez' })

      expect(prisma.novedad.create).toHaveBeenCalledWith({
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
      prisma.novedad.create.mockRejectedValue(new Error('db down'))

      await expect(
        service.recordSiniestro(5, { siniestroId: 6, clientId: 3, clienteNombre: 'Ana', descripcion: 'x' }),
      ).resolves.toBeUndefined()
    })
  })

  describe('listForAdmin', () => {
    it('orders unread first then newest, and applies pagination defaults', async () => {
      prisma.novedad.count.mockResolvedValue(1)
      prisma.novedad.findMany.mockResolvedValue([{ id: 8 }])

      const result = await service.listForAdmin(5, [10], {})

      expect(prisma.novedad.findMany).toHaveBeenCalledWith(
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
      prisma.novedad.count.mockResolvedValue(0)
      prisma.novedad.findMany.mockResolvedValue([])

      await service.listForAdmin(5, [10], { type: NovedadType.HANDOFF, unread: true })

      expect(prisma.novedad.count).toHaveBeenCalledWith({
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
      prisma.novedad.count.mockResolvedValue(0)
      prisma.novedad.findMany.mockResolvedValue([])

      await service.listForAdmin(5, [10], { clientId: 3, search: '30123' })

      expect(prisma.novedad.count).toHaveBeenCalledWith({
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
      prisma.novedad.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValue(2)

      const stats = await service.getStats(5, [10])

      expect(stats).toEqual({
        unreadTotal: 3,
        unreadSiniestros: 2,
        unreadHandoff: 1,
        unreadBajas: 0,
        actionableTotal: 12,
        actionableByCategory: { baja: 2, pagos: 2, cotizacion: 2, siniestro: 2, documentos: 2, other: 2 },
      })
    })
  })

  describe('matter queue', () => {
    it('keeps actionable filtering independent of read state and preserves code scope with search', async () => {
      prisma.novedad.count.mockResolvedValue(0)
      prisma.novedad.findMany.mockResolvedValue([])
      await service.listForAdmin(5, [10], {
        actionable: true,
        category: MatterCategory.BAJA,
        since: '2026-09-30T20:00:00Z',
        search: 'cancelar',
      })
      const where = prisma.novedad.count.mock.calls[0][0].where
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
      expect(prisma.novedad.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 8,
            producerId: 5,
            deletedAt: null,
            OR: [{ producerCodeId: { in: [10] } }, { producerCodeId: null }],
          },
        }),
      )
      expect(prisma.novedad.update).not.toHaveBeenCalled()
    })

    it('resolves and reopens without altering read state', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ type: 'handoff', refId: 1 })
      await service.updateMatter(8, 5, [10], { status: MatterStatus.RESOLVED })
      expect(prisma.novedad.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'resolved', resolvedAt: expect.any(Date) } }),
      )
      await service.updateMatter(8, 5, [10], { status: MatterStatus.PENDING })
      expect(prisma.novedad.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { status: 'pending', resolvedAt: null } }),
      )
    })

    it('updates the quote request in the same transaction', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ type: 'lead', refId: 21 })
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
      expect(prisma.novedad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: 'baja', body: 'Quiero dar de baja mi póliza' }),
        }),
      )
    })

    it('avoids exact repeats but preserves a different matter in the same chat', async () => {
      prisma.novedad.findFirst.mockResolvedValueOnce({ id: 8 }).mockResolvedValueOnce(null)
      const input = { conversationId: 1, clientId: null, clienteNombre: 'Ana' }
      await service.recordHandoff(5, { ...input, reason: 'ya pagué' })
      expect(prisma.novedad.create).not.toHaveBeenCalled()
      await service.recordHandoff(5, { ...input, reason: 'quiero dar de baja mi póliza' })
      expect(prisma.novedad.create).toHaveBeenCalledTimes(1)
    })

    it('refreshes a resubmitted quote instead of duplicating its matter', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 8 })
      await service.recordQuote(5, { type: NovedadType.SOLICITUD, refId: 21, name: 'Ana', summary: 'Eligió B1' })
      expect(prisma.novedad.create).not.toHaveBeenCalled()
      expect(prisma.novedad.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 8 },
          data: expect.objectContaining({ status: 'pending', readAt: null, resolvedAt: null }),
        }),
      )
    })

    it('returns the previous visit before advancing its timestamp', async () => {
      const previous = new Date('2026-09-29T12:00:00Z')
      prisma.user.findUniqueOrThrow.mockResolvedValue({ lastNovedadesVisitAt: previous })
      const result = await service.registerVisit(3)
      expect(result.previousVisitAt).toEqual(previous)
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { lastNovedadesVisitAt: result.visitedAt },
      })
    })
  })

  describe('markRead', () => {
    it('throws 404 when the novedad is not in this tenant', async () => {
      prisma.novedad.findFirst.mockResolvedValue(null)

      await expect(service.markRead(8, 5, [10])).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.novedad.update).not.toHaveBeenCalled()
    })

    it('stamps readAt the first time', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 8, readAt: null })
      prisma.novedad.update.mockResolvedValue({ id: 8, readAt: new Date() })

      await service.markRead(8, 5, [10])

      expect(prisma.novedad.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 }, data: { readAt: expect.any(Date) } }),
      )
    })

    it('is idempotent when the novedad is already read', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 8, readAt: new Date() })
      prisma.novedad.findFirstOrThrow.mockResolvedValue({ id: 8 })

      await service.markRead(8, 5, [10])

      expect(prisma.novedad.update).not.toHaveBeenCalled()
      expect(prisma.novedad.findFirstOrThrow).toHaveBeenCalled()
    })
  })

  describe('markAllRead', () => {
    it('marks all unread, optionally scoped to a type', async () => {
      prisma.novedad.updateMany.mockResolvedValue({ count: 4 })

      const result = await service.markAllRead(5, [10], NovedadType.SINIESTRO)

      expect(prisma.novedad.updateMany).toHaveBeenCalledWith({
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
