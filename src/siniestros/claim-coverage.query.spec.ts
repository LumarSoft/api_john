import { claimCoverageChecks } from './claim-coverage.query'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

const storedPolicy = (over: Record<string, unknown> = {}) => ({
  id: 9,
  clientId: 5,
  producerId: 2,
  riskType: 'auto',
  certificateNumber: '4400001',
  endorsementNumber: 0,
  lastMovement: 'POLIZA NUEVA',
  validFrom: d('2026-03-03'),
  validTo: d('2027-03-03'),
  rawData: { Vigencia: 12, VigenciaDesde: '2026-03-03' },
  vehicle: { licensePlate: 'AB123CD' },
  installments: [],
  paymentRejections: [],
  ...over,
})

describe('claimCoverageChecks', () => {
  let findMany: jest.Mock
  const prisma = () => ({ policy: { findMany } }) as never

  beforeEach(() => {
    findMany = jest.fn()
  })

  it('asks nothing for no claims', async () => {
    await expect(claimCoverageChecks(prisma(), [])).resolves.toEqual(new Map())
    expect(findMany).not.toHaveBeenCalled()
  })

  it('reads each policy once, with only its unpaid installments and still-unpaid rejections', async () => {
    findMany.mockResolvedValueOnce([
      storedPolicy({
        installments: [{ number: 7, dueDate: d('2026-09-03'), status: 'overdue', providerStatus: 'PENDIENTE' }],
      }),
    ])

    const checks = await claimCoverageChecks(prisma(), [
      { id: 1, occurredAt: d('2026-10-12'), policyId: 9 },
      { id: 2, occurredAt: d('2026-08-20'), policyId: 9 },
    ])

    expect(findMany).toHaveBeenCalledTimes(1)
    const { where, select } = findMany.mock.calls[0][0]
    expect(where).toEqual({ id: { in: [9] } })
    expect(select.installments.where).toEqual({ deletedAt: null, status: { in: ['pending', 'overdue'] } })
    expect(select.paymentRejections.where).toEqual({ deletedAt: null, stillPending: true })
    expect(checks.get(1)?.issues.map(i => i.code)).toEqual(['UNPAID_INSTALLMENTS'])
    expect(checks.get(2)).toEqual({ level: 'ok', issues: [] })
  })

  it("looks for the client's other policy of the same plate only when the day is outside the term", async () => {
    findMany.mockResolvedValueOnce([storedPolicy({ lastMovement: 'RENOVACION' })]).mockResolvedValueOnce([
      {
        certificateNumber: '4300009',
        endorsementNumber: 4,
        lastMovement: 'REFACTURACION',
        validFrom: d('2025-12-03'),
        validTo: d('2026-03-03'),
        rawData: { Vigencia: 12 },
      },
    ])

    const checks = await claimCoverageChecks(prisma(), [{ id: 1, occurredAt: d('2026-02-27'), policyId: 9 }])

    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany.mock.calls[1][0].where).toEqual({
      clientId: 5,
      producerId: 2,
      deletedAt: null,
      id: { not: 9 },
      vehicle: { licensePlate: 'AB123CD' },
    })
    expect(checks.get(1)?.issues.map(i => i.code)).toEqual(['OTHER_POLICY'])
  })

  it('matches a policy without a vehicle by its kind of risk', async () => {
    findMany.mockResolvedValueOnce([storedPolicy({ riskType: 'home', vehicle: null })]).mockResolvedValueOnce([])

    const checks = await claimCoverageChecks(prisma(), [{ id: 1, occurredAt: d('2027-05-01'), policyId: 9 }])

    expect(findMany.mock.calls[1][0].where).toMatchObject({ riskType: 'home', vehicle: null })
    expect(checks.get(1)?.issues.map(i => i.code)).toEqual(['AFTER_END'])
  })

  it('finds nothing against a claim whose policy is gone', async () => {
    findMany.mockResolvedValueOnce([])
    const checks = await claimCoverageChecks(prisma(), [{ id: 1, occurredAt: d('2026-10-12'), policyId: 9 }])
    expect(checks.get(1)).toEqual({ level: 'ok', issues: [] })
  })
})
