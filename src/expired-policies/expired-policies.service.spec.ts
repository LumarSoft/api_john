import type { PrismaService } from '../prisma/prisma.service'
import { ExpiredPoliciesService } from './expired-policies.service'
import { ExpiredPolicySort } from './dto/list-expired-policies.dto'

describe('ExpiredPoliciesService.list', () => {
  const now = new Date('2026-10-28T15:00:00Z')
  const client = (id: number, lastName: string) => ({
    id,
    firstName: 'Ana',
    lastName,
    dni: String(id),
    phone: null,
    email: null,
  })
  const expired = (
    id: number,
    clientId: number,
    validTo: string,
    vehicle: { licensePlate: string | null; brand?: string; model?: string; year?: number } | null,
    riskType = 'auto',
  ) => ({
    id,
    certificateNumber: String(1000 + id),
    riskType,
    validTo: new Date(validTo),
    paymentMethod: 'Convenio',
    rawData: {},
    hiddenAt: null,
    hiddenReason: null,
    clientId,
    producerCode: { id: 7, code: '14831' },
    client: client(clientId, `Cliente ${clientId}`),
    vehicle,
    installments: [],
  })

  function setup(candidates: unknown[], current: unknown[]) {
    const findMany = jest.fn().mockResolvedValueOnce(candidates).mockResolvedValueOnce(current)
    const count = jest.fn().mockResolvedValue(2)
    const service = new ExpiredPoliciesService({ policy: { findMany, count } } as unknown as PrismaService)
    return { service, findMany }
  }

  it('leaves out the policies renewed on the same plate, or on the same risk when there is no plate', async () => {
    const { service } = setup(
      [
        expired(1, 10, '2026-09-01', { licensePlate: 'AB 123 CD' }),
        expired(2, 10, '2026-08-01', { licensePlate: 'ZZ999ZZ' }),
        expired(3, 11, '2026-07-01', null, 'life'),
        expired(4, 12, '2026-06-01', null, 'life'),
      ],
      [
        { clientId: 10, riskType: 'auto', vehicle: { licensePlate: 'ab123cd' } },
        { clientId: 11, riskType: 'life', vehicle: null },
      ],
    )

    const page = await service.list(1, [7], {}, now)

    expect(page.data.map(r => r.id)).toEqual([4, 2])
    expect(page.total).toBe(2)
    expect(page.hiddenCount).toBe(2)
  })

  it('puts the longest expired first by default and the most recent first on request', async () => {
    const rows = [
      expired(1, 10, '2026-10-20', { licensePlate: 'A1' }),
      expired(2, 11, '2026-05-20', { licensePlate: 'B2' }),
    ]
    const oldest = await setup(rows, []).service.list(1, [7], {}, now)
    expect(oldest.data.map(r => r.daysExpired)).toEqual([161, 8])

    const recent = await setup(rows, []).service.list(1, [7], { sort: ExpiredPolicySort.RECENT }, now)
    expect(recent.data.map(r => r.id)).toEqual([1, 2])
  })

  it('asks only for the codes, the medio de pago and the year window in scope', async () => {
    const { service, findMany } = setup([], [])

    await service.list(1, [7, 9], { paymentMethod: 'Plan De Pago', hidden: true }, now)

    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      producerId: 1,
      deletedAt: null,
      producerCodeId: { in: [7, 9] },
      paymentMethod: 'Plan De Pago',
      hiddenAt: { not: null },
      NOT: [{ lastMovement: { startsWith: 'ANUL' } }, { lastMovement: { startsWith: 'RESCISION' } }],
    })
    expect(where.validTo.lt).toEqual(now)
    expect(where.validTo.gte.toISOString()).toBe('2025-10-28T15:00:00.000Z')
    // Nobody to look up renewals for.
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('describes the vehicle and the unpaid cuotas of each row', async () => {
    const row = {
      ...expired(1, 10, '2026-09-01', { licensePlate: 'AB123CD', brand: 'FIAT', model: 'PALIO', year: 2024 }),
      installments: [{ id: 1 }, { id: 2 }],
    }
    const { service } = setup([row], [])

    const page = await service.list(1, [7], {}, now)

    expect(page.data[0]).toMatchObject({
      certificateNumber: '1001',
      licensePlate: 'AB123CD',
      vehicle: 'FIAT PALIO 2024',
      daysExpired: 57,
      unpaidInstallments: 2,
      producerCode: { code: '14831' },
    })
  })
})

describe('ExpiredPoliciesService.hide', () => {
  it('hides a policy of the codes in scope with the reason and who did it', async () => {
    const update = jest.fn().mockResolvedValue({ id: 5, hiddenAt: new Date(), hiddenReason: 'Vendió el auto' })
    const findFirst = jest.fn().mockResolvedValue({ id: 5 })
    const service = new ExpiredPoliciesService({ policy: { findFirst, update } } as unknown as PrismaService)

    await service.hide(5, 1, [7], 42, '  Vendió el auto ')

    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 5, producerId: 1, producerCodeId: { in: [7] } })
    expect(update.mock.calls[0][0].data).toMatchObject({ hiddenReason: 'Vendió el auto', hiddenById: 42 })
    expect(update.mock.calls[0][0].data.hiddenAt).toBeInstanceOf(Date)
  })

  it('refuses a policy outside the user scope', async () => {
    const service = new ExpiredPoliciesService({
      policy: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as unknown as PrismaService)

    await expect(service.unhide(5, 1, [7])).rejects.toThrow('Policy 5 not found')
  })
})
