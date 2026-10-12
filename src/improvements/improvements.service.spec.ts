import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { ImprovementsService } from './improvements.service'

describe('ImprovementsService', () => {
  function setup(
    overrides: {
      current?: { id: number; publishedAt: Date | null; releasedOn?: Date | null } | null
      lastVisit?: Date | null
    } = {},
  ) {
    const prisma = {
      improvement: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'current' in overrides ? overrides.current : { id: 1, publishedAt: null, releasedOn: null },
          ),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ lastImprovementsVisitAt: overrides.lastVisit ?? null }),
        update: jest.fn().mockResolvedValue({}),
      },
      producer: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
    const service = new ImprovementsService(prisma as unknown as PrismaService)
    return { service, prisma }
  }

  it('shows an organization only published improvements meant for it or for everyone', async () => {
    const { service, prisma } = setup()

    await service.listPublished(7)

    expect(prisma.improvement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, publishedAt: { not: null }, OR: [{ producerId: 7 }, { producerId: null }] },
      }),
    )
  })

  it('counts every published improvement as unseen before the first visit', async () => {
    const { service, prisma } = setup({ lastVisit: null })

    await expect(service.countUnseen(5, 7)).resolves.toEqual({ count: 3 })
    expect(prisma.improvement.count).toHaveBeenCalledWith({
      where: { deletedAt: null, publishedAt: { not: null }, OR: [{ producerId: 7 }, { producerId: null }] },
    })
  })

  it('counts only what was published after the last visit', async () => {
    const lastVisit = new Date('2026-10-10T12:00:00Z')
    const { service, prisma } = setup({ lastVisit })

    await service.countUnseen(5, 7)

    expect(prisma.improvement.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ publishedAt: { not: null, gt: lastVisit } }),
    })
  })

  it('returns the previous visit and stamps the new one', async () => {
    const lastVisit = new Date('2026-10-10T12:00:00Z')
    const { service, prisma } = setup({ lastVisit })

    const result = await service.registerVisit(5)

    expect(result.previousVisitAt).toBe(lastVisit)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { lastImprovementsVisitAt: result.visitedAt },
    })
  })

  it('creates a draft unless asked to publish, storing empty optional texts as null', async () => {
    const { service, prisma } = setup()

    await service.create({ title: ' Título ', summary: 'Resumen', beforeText: '   ', area: 'BOT' })

    expect(prisma.improvement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Título', beforeText: null, publishedAt: null, producerId: null }),
      }),
    )
  })

  it('rejects an organization that does not exist', async () => {
    const { service, prisma } = setup()
    prisma.producer.findFirst.mockResolvedValue(null)

    await expect(service.create({ title: 'T', summary: 'S', area: 'BOT', producerId: 99 })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('keeps the original date when an already published improvement is saved again', async () => {
    const originalDate = new Date('2026-10-01T10:00:00Z')
    const { service, prisma } = setup({ current: { id: 1, publishedAt: originalDate } })

    await service.update(1, { title: 'Corregido', published: true })

    expect(prisma.improvement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: originalDate }) }),
    )
  })

  it('publishes a draft with the current date and turns it back into a draft on request', async () => {
    const { service, prisma } = setup({ current: { id: 1, publishedAt: null } })

    await service.update(1, { published: true })
    const published = prisma.improvement.update.mock.calls[0][0].data.publishedAt
    expect(published).toBeInstanceOf(Date)

    await service.update(1, { published: false })
    expect(prisma.improvement.update.mock.calls[1][0].data.publishedAt).toBeNull()
  })

  it('dates a published improvement today when it has no date, and keeps a given one', async () => {
    const { service, prisma } = setup({ current: { id: 1, publishedAt: null, releasedOn: null } })

    await service.update(1, { published: true })
    expect(prisma.improvement.update.mock.calls[0][0].data.releasedOn).toBeInstanceOf(Date)

    await service.create({ title: 'T', summary: 'S', area: 'BOT', published: true, releasedOn: '2026-10-09' })
    expect(prisma.improvement.create.mock.calls[0][0].data.releasedOn).toEqual(new Date('2026-10-09T00:00:00Z'))
  })

  it('soft-deletes and 404s on a missing improvement', async () => {
    const { service, prisma } = setup()
    await service.remove(1)
    expect(prisma.improvement.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { deletedAt: expect.any(Date) } })

    const missing = setup({ current: null })
    await expect(missing.service.remove(2)).rejects.toBeInstanceOf(NotFoundException)
  })
})
