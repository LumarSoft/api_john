import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { HolidaySyncService } from './holiday-sync.service'

describe('HolidaySyncService', () => {
  // Monday 12/10/2026, 10:00 in Argentina.
  const now = new Date('2026-10-12T13:00:00Z')

  const calendar2026 = [
    { fecha: '2026-10-07', tipo: 'inamovible', nombre: 'Ya pasó' },
    { fecha: '2026-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
    { fecha: '2026-11-09', tipo: 'inamovible', nombre: 'Visita del papa León XIV' },
    { fecha: '2026-12-07', tipo: 'puente', nombre: 'Puente turístico no laborable' },
    { fecha: 'mal', tipo: 'inamovible', nombre: 'Fecha inválida' },
  ]
  const calendar2027 = [{ fecha: '2027-01-01', tipo: 'inamovible', nombre: 'Año nuevo' }]

  function setup(
    env: Record<string, string> = {},
    existing: { phoneNumberId: number; startDate: Date }[] = [],
    upcoming: { id: number; startDate: Date; reason: string }[] = [],
  ) {
    const prisma = {
      // Every number of every active organization gets its own copy of each holiday.
      phoneNumber: { findMany: jest.fn().mockResolvedValue([{ id: 8, producerId: 1 }]) },
      businessClosure: {
        // First call: upcoming active automatic closures (moved-holiday check); second: everything already loaded.
        findMany: jest.fn().mockResolvedValueOnce(upcoming).mockResolvedValueOnce(existing),
        createMany: jest.fn().mockImplementation(({ data }) => Promise.resolve({ count: data.length })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const config = { get: jest.fn((key: string) => env[key]) }
    const service = new HolidaySyncService(prisma as unknown as PrismaService, config as unknown as ConfigService)
    return { service, prisma }
  }

  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(url.endsWith('/2026') ? calendar2026 : calendar2027),
      }),
    )
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const createdDates = (prisma: ReturnType<typeof setup>['prisma']) =>
    (prisma.businessClosure.createMany.mock.calls[0][0].data as { startDate: Date }[]).map(d =>
      d.startDate.toISOString().slice(0, 10),
    )

  it('loads the upcoming national holidays of this year and the next, today included, without puentes', async () => {
    const { service, prisma } = setup()

    await expect(service.sync(now)).resolves.toEqual({ created: 3, removed: 0 })
    expect(createdDates(prisma)).toEqual(['2026-10-12', '2026-11-09', '2027-01-01'])
    expect(prisma.businessClosure.createMany.mock.calls[0][0].data[0]).toEqual({
      producerId: 1,
      phoneNumberId: 8,
      startDate: new Date('2026-10-12T00:00:00Z'),
      endDate: new Date('2026-10-12T00:00:00Z'),
      reason: 'feriado nacional: Día del Respeto a la Diversidad Cultural',
      source: 'holiday',
    })
  })

  it('does not create again a holiday already loaded on the number or deleted by its admin', async () => {
    const { service, prisma } = setup({}, [{ phoneNumberId: 8, startDate: new Date('2026-11-09T00:00:00Z') }])

    await service.sync(now)

    expect(createdDates(prisma)).toEqual(['2026-10-12', '2027-01-01'])
    // The lookup must not filter out soft-deleted rows.
    expect(prisma.businessClosure.findMany.mock.calls[1][0].where).not.toHaveProperty('deletedAt')
  })

  it('loads each holiday into every number, so one branch can open on it and another close', async () => {
    const { service, prisma } = setup({}, [{ phoneNumberId: 8, startDate: new Date('2026-11-09T00:00:00Z') }])
    prisma.phoneNumber.findMany.mockResolvedValue([
      { id: 8, producerId: 1 },
      { id: 11, producerId: 1 },
    ])

    await service.sync(now)

    const created = prisma.businessClosure.createMany.mock.calls[0][0].data as {
      phoneNumberId: number
      startDate: Date
    }[]
    // Number 8 opened on 9/11 (its row was deleted); number 11 still closes that day.
    expect(created.filter(c => c.phoneNumberId === 11).map(c => c.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-10-12',
      '2026-11-09',
      '2027-01-01',
    ])
    expect(created.filter(c => c.phoneNumberId === 8).map(c => c.startDate.toISOString().slice(0, 10))).toEqual([
      '2026-10-12',
      '2027-01-01',
    ])
  })

  it('includes puentes when HOLIDAY_TYPES asks for them', async () => {
    const { service, prisma } = setup({ HOLIDAY_TYPES: 'inamovible,trasladable,puente' })

    await service.sync(now)

    expect(createdDates(prisma)).toContain('2026-12-07')
  })

  it('keeps going with the year it got when the other is unavailable', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/2027')
        ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(calendar2026) }),
    )
    const { service } = setup()

    await expect(service.sync(now)).resolves.toEqual({ created: 2, removed: 0 })
  })

  it('removes an upcoming automatic holiday the calendar no longer has, only for fetched years', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/2027')
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(calendar2026) }),
    )
    const { service, prisma } = setup(
      {},
      [],
      [
        { id: 10, startDate: new Date('2026-11-20T00:00:00Z'), reason: 'feriado nacional: movido al 23' },
        { id: 11, startDate: new Date('2026-11-09T00:00:00Z'), reason: 'feriado nacional: sigue' },
        { id: 12, startDate: new Date('2027-03-24T00:00:00Z'), reason: 'feriado nacional: año no consultado' },
      ],
    )

    await expect(service.sync(now)).resolves.toEqual({ created: 2, removed: 1 })
    expect(prisma.businessClosure.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10] } },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('creates nothing when the source is down', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))
    const { service, prisma } = setup()

    await expect(service.sync(now)).resolves.toEqual({ created: 0, removed: 0 })
    expect(prisma.businessClosure.createMany).not.toHaveBeenCalled()
    expect(prisma.businessClosure.updateMany).not.toHaveBeenCalled()
  })
})
