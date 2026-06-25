import { NotFoundException } from '@nestjs/common'
import { NovedadesService } from './novedades.service'
import { NovedadType } from './dto/list-novedades.dto'

function createPrismaMock() {
  return {
    novedad: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    // Resolves the array form used by listForAdmin / getStats.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
}

describe('NovedadesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: NovedadesService

  beforeEach(() => {
    prisma = createPrismaMock()
    service = new NovedadesService(prisma as never)
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
          refId: 6,
          clientId: 3,
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
          refId: 1,
          clientId: null,
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

      const result = await service.listForAdmin(5, {})

      expect(prisma.novedad.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { producerId: 5, deletedAt: null },
          orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
          skip: 0,
          take: 20,
        }),
      )
      expect(result).toEqual({ data: [{ id: 8 }], total: 1, page: 1, pageSize: 20, totalPages: 1 })
    })

    it('filters by type and unread when requested', async () => {
      prisma.novedad.count.mockResolvedValue(0)
      prisma.novedad.findMany.mockResolvedValue([])

      await service.listForAdmin(5, { type: NovedadType.HANDOFF, unread: true })

      expect(prisma.novedad.count).toHaveBeenCalledWith({
        where: { producerId: 5, deletedAt: null, type: 'handoff', readAt: null },
      })
    })

    it('filters by clientId and by a DNI/name search against the linked client', async () => {
      prisma.novedad.count.mockResolvedValue(0)
      prisma.novedad.findMany.mockResolvedValue([])

      await service.listForAdmin(5, { clientId: 3, search: '30123' })

      expect(prisma.novedad.count).toHaveBeenCalledWith({
        where: {
          producerId: 5,
          deletedAt: null,
          clientId: 3,
          client: {
            OR: [
              { firstName: { contains: '30123' } },
              { lastName: { contains: '30123' } },
              { dni: { contains: '30123' } },
            ],
          },
        },
      })
    })
  })

  describe('getStats', () => {
    it('returns unread counters by category', async () => {
      prisma.novedad.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(1)

      const stats = await service.getStats(5)

      expect(stats).toEqual({ unreadTotal: 3, unreadSiniestros: 2, unreadHandoff: 1 })
    })
  })

  describe('markRead', () => {
    it('throws 404 when the novedad is not in this tenant', async () => {
      prisma.novedad.findFirst.mockResolvedValue(null)

      await expect(service.markRead(8, 5)).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.novedad.update).not.toHaveBeenCalled()
    })

    it('stamps readAt the first time', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 8, readAt: null })
      prisma.novedad.update.mockResolvedValue({ id: 8, readAt: new Date() })

      await service.markRead(8, 5)

      expect(prisma.novedad.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 }, data: { readAt: expect.any(Date) } }),
      )
    })

    it('is idempotent when the novedad is already read', async () => {
      prisma.novedad.findFirst.mockResolvedValue({ id: 8, readAt: new Date() })
      prisma.novedad.findFirstOrThrow.mockResolvedValue({ id: 8 })

      await service.markRead(8, 5)

      expect(prisma.novedad.update).not.toHaveBeenCalled()
      expect(prisma.novedad.findFirstOrThrow).toHaveBeenCalled()
    })
  })

  describe('markAllRead', () => {
    it('marks all unread, optionally scoped to a type', async () => {
      prisma.novedad.updateMany.mockResolvedValue({ count: 4 })

      const result = await service.markAllRead(5, NovedadType.SINIESTRO)

      expect(prisma.novedad.updateMany).toHaveBeenCalledWith({
        where: { producerId: 5, deletedAt: null, readAt: null, type: 'siniestro' },
        data: { readAt: expect.any(Date) },
      })
      expect(result).toEqual({ updated: 4 })
    })
  })
})
