import type { PrismaService } from '../prisma/prisma.service'
import { ClientsService } from './clients.service'

describe('ClientsService.findPolizas (portal)', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const poliza = (id: number, dominio: string | null, status: string, desde: string, hasta: string) => ({
    id,
    certificado: String(id),
    status,
    vigenciaDesde: d(desde),
    vigenciaHasta: d(hasta),
    rawData: {},
    vehiculo: dominio ? { dominio } : null,
  })

  async function list(rows: ReturnType<typeof poliza>[]) {
    // The service orders by vigenciaDesde desc; the mock returns rows in that order.
    const prisma = { poliza: { findMany: jest.fn().mockResolvedValue(rows) } }
    const service = new ClientsService(prisma as unknown as PrismaService)
    const res = await service.findPolizas(1, 1)
    return res.map(p => ({ id: p.id, estado: p.estadoVigencia }))
  }

  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-09-30T12:00:00Z') })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('shows the policy in force and its upcoming renewal for the same car, labelled', async () => {
    const res = await list([
      poliza(1995688, 'GLQ276', 'RENOVACION', '2026-10-03', '2027-10-03'),
      poliza(1741715, 'GLQ276', 'REFACTURACION', '2026-03-03', '2026-10-03'),
      poliza(1500000, 'GLQ276', 'REFACTURACION', '2025-03-03', '2025-10-03'),
    ])

    expect(res).toEqual([
      { id: 1995688, estado: 'proxima' },
      { id: 1741715, estado: 'vigente' },
    ])
  })

  it('shows only the most recent one when a car has nothing active', async () => {
    const res = await list([
      poliza(3, 'AB123CD', 'ANULA POR VENTA', '2026-02-27', '2027-02-27'),
      poliza(2, 'AB123CD', 'REFACTURACION', '2025-02-27', '2026-02-27'),
    ])

    expect(res).toEqual([{ id: 3, estado: 'anulada' }])
  })

  it('keeps every non-vehicle policy', async () => {
    const res = await list([
      poliza(10, null, 'REFACTURACION', '2026-01-01', '2027-01-01'),
      poliza(11, null, 'REFACTURACION', '2024-01-01', '2025-01-01'),
    ])

    expect(res).toEqual([
      { id: 10, estado: 'vigente' },
      { id: 11, estado: 'vencida' },
    ])
  })
})
