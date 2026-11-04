import type { PrismaService } from '../prisma/prisma.service'
import { CAMPAIGNS, settingsOf } from './campaign-catalog'
import { CampaignFinderService } from './campaign-finder.service'

const NOW = new Date('2026-11-04T15:00:00Z')

/** A policy row as the finder selects it (fictitious data). */
function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    clientId: 60,
    riskType: 'auto',
    validTo: new Date('2026-11-20T03:00:00Z'),
    lastMovement: 'RENOVACION',
    rawData: {},
    updatedAt: NOW,
    producerCodeId: 3,
    producerCode: { id: 3, code: '11425' },
    client: {
      id: 60,
      firstName: 'JUAN CARLOS',
      lastName: 'PEREZ',
      dni: '20999001',
      phone: '341159990001',
      deletedAt: null,
    },
    vehicle: { licensePlate: 'AB123CD', brand: 'FORD', model: 'KA 1.5 SE', year: 2015, coverage: 'A' },
    ...overrides,
  }
}

function setup(prisma: Record<string, unknown>) {
  return new CampaignFinderService(prisma as unknown as PrismaService)
}

describe('CampaignFinderService', () => {
  it('greets by first name and names the vehicle as a person would', async () => {
    const finder = setup({ policy: { findMany: jest.fn().mockResolvedValue([policy()]) } })

    const [found] = await finder.find(
      CAMPAIGNS.coverage_upgrade,
      settingsOf(CAMPAIGNS.coverage_upgrade, null),
      7,
      [3],
      NOW,
    )

    expect(found).toEqual(
      expect.objectContaining({
        id: 100,
        name: 'Juan Carlos Perez',
        firstName: 'Juan',
        bien: 'Ford Ka',
        item: 'Ford Ka 1.5 Se 2015 · AB123CD',
        detail: 'Cobertura A',
      }),
    )
  })

  it('leaves a renewal out once the next policy of the same vehicle is issued', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        policy({ id: 100 }),
        policy({ id: 101, clientId: 61, vehicle: { ...policy().vehicle, licensePlate: 'ZZ999ZZ' } }),
      ])
      .mockResolvedValueOnce([
        {
          id: 100,
          clientId: 60,
          riskType: 'auto',
          validTo: new Date('2026-11-20T03:00:00Z'),
          vehicle: { licensePlate: 'AB123CD' },
        },
        {
          id: 200,
          clientId: 60,
          riskType: 'auto',
          validTo: new Date('2027-11-20T03:00:00Z'),
          vehicle: { licensePlate: 'AB 123 CD' },
        },
        {
          id: 101,
          clientId: 61,
          riskType: 'auto',
          validTo: new Date('2026-11-20T03:00:00Z'),
          vehicle: { licensePlate: 'ZZ999ZZ' },
        },
      ])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(CAMPAIGNS.renewal, settingsOf(CAMPAIGNS.renewal, null), 7, [3], NOW)

    expect(found.map(f => f.id)).toEqual([101])
    expect(found[0].detail).toBe('Vence el 20/11/2026')
  })

  it('finds a cancellation by the date Triunfo issued it, unless the vehicle is insured again', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        policy({ id: 1, lastMovement: 'ANULA COBRANZA', rawData: { FechaEmision: '2026-09-10' } }),
        policy({ id: 2, clientId: 62, lastMovement: 'ANULA COBRANZA', rawData: { FechaEmision: '2025-01-10' } }),
        policy({ id: 3, clientId: 63, lastMovement: 'ANULA DESISTIM.ASEG.', rawData: { FechaEmision: '2026-10-01' } }),
      ])
      .mockResolvedValueOnce([
        {
          id: 30,
          clientId: 63,
          riskType: 'auto',
          validTo: new Date('2027-10-01'),
          vehicle: { licensePlate: 'AB123CD' },
        },
      ])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(CAMPAIGNS.winback, settingsOf(CAMPAIGNS.winback, null), 7, [3], NOW)

    expect(found.map(f => [f.id, f.detail])).toEqual([[1, 'Anulada el 10/09/2026 (por falta de pago)']])
  })

  it('follows up the latest quote of each chat unless it ended in a policy', async () => {
    const chat = (id: number, clientId: number | null) => ({
      id,
      waId: `54934100000${id}`,
      contactName: 'Laura',
      contactNameManual: null,
      clientId,
      client: clientId ? { id: clientId, firstName: 'ANA', lastName: 'GOMEZ', dni: '27999002' } : null,
    })
    const quote = (id: number, conversation: ReturnType<typeof chat>, createdAt: string) => ({
      id,
      createdAt: new Date(createdAt),
      vehicleType: 'AUTO',
      vehicleLabel: 'VOLKSWAGEN GOL TREND 1.6',
      manufactureYear: 2018,
      producerCodeId: 3,
      producerCode: { id: 3, code: '11425' },
      conversation,
    })
    const finder = setup({
      phoneNumber: { findMany: jest.fn().mockResolvedValue([{ phoneNumberId: 'meta-office' }]) },
      quote: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            quote(11, chat(1, null), '2026-11-01T12:00:00Z'),
            quote(10, chat(1, null), '2026-10-30T12:00:00Z'),
            quote(20, chat(2, 70), '2026-10-29T12:00:00Z'),
          ]),
      },
      policy: {
        findMany: jest.fn().mockResolvedValue([{ clientId: 70, createdAt: new Date('2026-10-31T12:00:00Z') }]),
      },
    })

    const found = await finder.find(CAMPAIGNS.quote_followup, settingsOf(CAMPAIGNS.quote_followup, null), 7, [3], NOW)

    expect(found).toEqual([
      expect.objectContaining({
        id: 11,
        name: 'Laura',
        firstName: 'Laura',
        waId: '549341000001',
        bien: 'Volkswagen Gol',
        detail: 'Cotizó el 01/11/2026',
      }),
    ])
  })
})
