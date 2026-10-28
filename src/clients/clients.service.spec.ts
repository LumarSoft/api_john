import type { PrismaService } from '../prisma/prisma.service'
import { ClientsService } from './clients.service'

describe('ClientsService.findPolizas (portal)', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const poliza = (id: number, licensePlate: string | null, lastMovement: string, desde: string, hasta: string) => ({
    id,
    certificateNumber: String(id),
    lastMovement,
    validFrom: d(desde),
    validTo: d(hasta),
    rawData: {},
    vehicle: licensePlate ? { licensePlate } : null,
  })

  async function list(rows: ReturnType<typeof poliza>[]) {
    // The service orders by validFrom desc; the mock returns rows in that order.
    const prisma = { policy: { findMany: jest.fn().mockResolvedValue(rows) } }
    const service = new ClientsService(prisma as unknown as PrismaService)
    const res = await service.findPolizas(1, 1)
    return res.map(p => ({ id: p.id, estado: p.validityStatus }))
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

  it('names a personal accident policy as such, not as Vida', async () => {
    const ap = {
      ...poliza(20, null, 'REFACTURACION', '2026-01-01', '2027-01-01'),
      riskType: 'life',
      rawData: {
        Articulo: 128,
        SDTOtrosRiesgosDatos: { SDTRiesgosCoberturas: [{ Riesgo: 'CATEGORIA 4', Cobertura: 'MUERTE' }] },
      },
    }
    const prisma = { policy: { findMany: jest.fn().mockResolvedValue([ap]) } }
    const service = new ClientsService(prisma as unknown as PrismaService)

    const [res] = await service.findPolizas(1, 1)

    expect(res.product).toBe('Acc. personales')
    expect(res).not.toHaveProperty('rawData')
  })
})

describe('ClientsService.findCobranzasForAdmin', () => {
  const cuota = (status: string, amount: string, dueDate = '2026-09-10') => ({
    status,
    amount,
    dueDate: new Date(dueDate),
  })
  const client = {
    id: 1,
    firstName: 'Ana',
    lastName: 'Pérez',
    dni: '1',
    email: null,
    phone: null,
    policies: [
      {
        riskType: 'auto',
        paymentMethod: 'Plan De Pago',
        vehicle: { licensePlate: 'AB123CD' },
        installments: [cuota('overdue', '100')],
      },
      {
        riskType: 'moto',
        paymentMethod: 'Convenio',
        vehicle: null,
        installments: [cuota('pending', '50', '2026-12-01')],
      },
    ],
  }

  function setup() {
    const findMany = jest.fn().mockResolvedValue([client])
    const service = new ClientsService({ client: { findMany } } as unknown as PrismaService)
    return { service, findMany }
  }

  it('counts only the cuotas of live policies of the codes in scope, with the medio de pago asked for', async () => {
    const { service, findMany } = setup()

    const page = await service.findCobranzasForAdmin(1, [7, 9], { paymentMethod: 'Plan De Pago' })

    const nested = findMany.mock.calls[0][0].select.policies.where
    expect(nested).toMatchObject({
      deletedAt: null,
      producerCodeId: { in: [7, 9] },
      paymentMethod: 'Plan De Pago',
      NOT: [{ lastMovement: { startsWith: 'ANUL' } }, { lastMovement: { startsWith: 'RESCISION' } }],
    })
    expect(findMany.mock.calls[0][0].where.policies.some).toMatchObject({ producerCodeId: { in: [7, 9] } })
    expect(page.data[0]).toMatchObject({
      paymentMethods: ['Plan De Pago', 'Convenio'],
      overdueCount: 1,
      pendingCount: 1,
      totalDebt: '150.00',
      oldestOverdueDate: new Date('2026-09-10').toISOString(),
    })
  })

  it('does not ask for a medio de pago when none is selected', async () => {
    const { service, findMany } = setup()

    await service.findCobranzasForAdmin(1, [7], {})

    expect(findMany.mock.calls[0][0].select.policies.where).not.toHaveProperty('paymentMethod')
  })
})
