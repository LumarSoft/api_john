import { SiniestrosService } from './siniestros.service'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('SiniestrosService: cover of the claim', () => {
  let prisma: {
    claim: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock; create: jest.Mock }
    policy: { findFirst: jest.Mock; findMany: jest.Mock }
    client: { findUnique: jest.Mock }
    $transaction: jest.Mock
  }
  let mail: { sendSiniestroNotification: jest.Mock }
  let novedades: { recordSiniestro: jest.Mock }
  let service: SiniestrosService

  const claim = (over: Record<string, unknown> = {}) => ({
    id: 31,
    type: 'auto',
    description: 'Choque en una esquina',
    occurredAt: d('2026-10-12'),
    status: 'pending',
    insurerClaimNumber: null,
    attachments: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: 5, firstName: 'Ana', lastName: 'Pérez', dni: '12345678', email: null, phone: null },
    policy: {
      id: 9,
      certificateNumber: '4400001',
      company: 'triunfo',
      riskType: 'auto',
      vehicle: { licensePlate: 'AB123CD', brand: 'FIAT', model: 'CRONOS' },
    },
    ...over,
  })

  const storedPolicy = (over: Record<string, unknown> = {}) => ({
    id: 9,
    clientId: 5,
    producerId: 2,
    riskType: 'auto',
    certificateNumber: '4400001',
    endorsementNumber: 4,
    lastMovement: 'REFACTURACION',
    validFrom: d('2026-03-03'),
    validTo: d('2027-03-03'),
    rawData: { Vigencia: 12, VigenciaDesde: '2026-09-03', DocNumero: '12345678' },
    vehicle: { licensePlate: 'AB123CD' },
    installments: [],
    paymentRejections: [],
    ...over,
  })

  beforeEach(() => {
    prisma = {
      claim: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
      policy: { findFirst: jest.fn(), findMany: jest.fn() },
      client: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    }
    mail = { sendSiniestroNotification: jest.fn().mockResolvedValue(undefined) }
    novedades = { recordSiniestro: jest.fn().mockResolvedValue(undefined) }
    service = new SiniestrosService(prisma as never, mail as never, novedades as never)
  })

  it('shows on the claim that Triunfo cancelled its policy over unpaid installments', async () => {
    prisma.claim.findFirst.mockResolvedValue(claim())
    prisma.policy.findMany.mockResolvedValueOnce([
      storedPolicy({ lastMovement: 'ANULA COBRANZA', rawData: { Vigencia: 12, VigenciaDesde: '2026-09-03' } }),
    ])

    const detail = await service.findOneForAdmin(31, 2, [1])

    expect(detail.coverageCheck).toEqual({
      level: 'danger',
      issues: [
        {
          code: 'CANCELLED',
          level: 'danger',
          title: 'Póliza anulada por falta de pago',
          detail:
            'Triunfo la anuló (ANULA COBRANZA) con efecto desde el 03/09/2026. El hecho fue el 12/10/2026: ese día ya no tenía cobertura.',
          date: '2026-09-03',
        },
      ],
    })
  })

  it("never returns the policy's raw row", async () => {
    prisma.claim.findFirst.mockResolvedValue(claim())
    prisma.policy.findMany.mockResolvedValueOnce([storedPolicy()])

    const detail = await service.findOneForAdmin(31, 2, [1])

    expect(detail.coverageCheck).toEqual({ level: 'ok', issues: [] })
    expect(JSON.stringify(detail)).not.toContain('DocNumero')
    expect(detail.policy).toEqual(claim().policy)
  })

  it('checks every claim of a page with one read of their policies', async () => {
    prisma.$transaction.mockResolvedValue([
      2,
      [claim(), claim({ id: 32, occurredAt: d('2027-04-01'), policy: { ...claim().policy, id: 10 } })],
    ])
    prisma.policy.findMany
      .mockResolvedValueOnce([
        storedPolicy({
          installments: [{ number: 7, dueDate: d('2026-09-03'), status: 'overdue', providerStatus: 'PENDIENTE' }],
        }),
        storedPolicy({ id: 10, certificateNumber: '4400002' }),
      ])
      .mockResolvedValueOnce([])

    const page = await service.findAllForAdmin(2, [1], {})

    expect(prisma.policy.findMany.mock.calls[0][0].where).toEqual({ id: { in: [9, 10] } })
    expect(page.data.map(c => [c.id, c.coverageCheck.level, c.coverageCheck.issues[0]?.code])).toEqual([
      [31, 'warning', 'UNPAID_INSTALLMENTS'],
      [32, 'danger', 'AFTER_END'],
    ])
  })

  it('opens the matter and the e-mail of a portal claim with what Triunfo states against its cover', async () => {
    prisma.policy.findFirst.mockResolvedValue({
      id: 9,
      certificateNumber: '4400001',
      company: 'triunfo',
      producerCodeId: 1,
      vehicle: { licensePlate: 'AB123CD' },
    })
    prisma.claim.create.mockResolvedValue(claim({ occurredAt: d('2027-04-01') }))
    prisma.policy.findMany.mockResolvedValueOnce([storedPolicy()]).mockResolvedValueOnce([])
    prisma.client.findUnique.mockResolvedValue({ firstName: 'Ana', lastName: 'Pérez', dni: '12345678', email: null })

    await service.create(5, 2, { policyId: 9, type: 'auto', description: 'Choque', occurredAt: '2027-04-01' }, [])

    const alerta = novedades.recordSiniestro.mock.calls[0][1].alerta
    expect(alerta).toContain('El hecho es posterior al vencimiento de la póliza')
    expect(mail.sendSiniestroNotification.mock.calls[0][0].alerta).toBe(alerta)
  })
})
