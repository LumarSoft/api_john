import type { PrismaService } from '../prisma/prisma.service'
import { CAMPAIGNS, settingsOf } from './campaign-catalog'
import { CampaignFinderService } from './campaign-finder.service'

const NOW = new Date('2026-11-04T15:00:00Z')

/** Mili's scope: code 3 of the office, whose only number is `meta-office` (fictitious). */
function scopeOf(codeIds: number[]) {
  return { codeIds, chats: { codeIds, ownNumbers: ['meta-office'], defaultNumber: 'meta-office' } }
}

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
      scopeOf([3]),
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

    const found = await finder.find(CAMPAIGNS.renewal, settingsOf(CAMPAIGNS.renewal, null), 7, scopeOf([3]), NOW)

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

    const found = await finder.find(CAMPAIGNS.winback, settingsOf(CAMPAIGNS.winback, null), 7, scopeOf([3]), NOW)

    expect(found.map(f => [f.id, f.detail])).toEqual([[1, 'Anulada el 10/09/2026 (por falta de pago)']])
  })

  it('says why each policy was cancelled, so the list can be filtered by it', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        policy({ id: 1, lastMovement: 'ANULA COBRANZA', rawData: { FechaEmision: '2026-09-10' } }),
        policy({
          id: 2,
          clientId: 62,
          lastMovement: 'ANULA P/ MOTIVOS VS.',
          rawData: { FechaEmision: '2026-10-10' },
        }),
        policy({ id: 3, clientId: 63, lastMovement: 'ANUL.P/CAMBIO DE CIA', rawData: { FechaEmision: '2026-10-20' } }),
      ])
      .mockResolvedValueOnce([])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(CAMPAIGNS.winback, settingsOf(CAMPAIGNS.winback, null), 7, scopeOf([3]), NOW)

    expect(found.map(f => [f.id, f.reason, f.sortDate?.toISOString().slice(0, 10)])).toEqual([
      [1, 'falta_pago', '2026-09-10'],
      [2, 'otros', '2026-10-10'],
      [3, 'cambio_compania', '2026-10-20'],
    ])
    expect(found[2].detail).toBe('Anulada el 20/10/2026 (por cambio de compañía)')
  })

  it('sorts a coverage upgrade by when the policy started and shows it', async () => {
    const finder = setup({
      policy: { findMany: jest.fn().mockResolvedValue([policy({ validFrom: new Date('2026-11-04T00:00:00Z') })]) },
    })

    const [found] = await finder.find(
      CAMPAIGNS.coverage_upgrade,
      settingsOf(CAMPAIGNS.coverage_upgrade, null),
      7,
      scopeOf([3]),
      NOW,
    )

    expect(found.detail).toBe('Cobertura A · vigente desde 04/11/2026')
    expect(found.coverages).toEqual(['A'])
    expect(found.sortDate).toEqual(new Date('2026-11-04T00:00:00Z'))
  })

  it('offers cross-sell once per client, by the policy that started last, with all their coverages', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        policy({ id: 1, validFrom: new Date('2026-03-01T00:00:00Z') }),
        policy({
          id: 2,
          riskType: 'moto',
          validFrom: new Date('2026-10-01T00:00:00Z'),
          vehicle: { licensePlate: 'A123BCD', brand: 'HONDA', model: 'WAVE', year: 2022, coverage: 'C2 Full' },
        }),
      ])
      .mockResolvedValueOnce([])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(CAMPAIGNS.cross_sell, settingsOf(CAMPAIGNS.cross_sell, null), 7, scopeOf([3]), NOW)

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe(2)
    expect(found[0].coverages.sort()).toEqual(['A', 'C2 Full'])
    expect(found[0].detail).toBe('Tiene seguro de moto (cobertura C2 Full), no de hogar · vigente desde 01/10/2026')
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

    const found = await finder.find(
      CAMPAIGNS.quote_followup,
      settingsOf(CAMPAIGNS.quote_followup, null),
      7,
      scopeOf([3]),
      NOW,
    )

    // By the number the person wrote to, never by the quote's code (the bot credits every quote to the master code).
    const where = (finder['prisma'].quote.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.OR).toEqual([
      { phoneNumberId: { in: ['meta-office'] } },
      { phoneNumberId: null, conversation: { phoneNumberId: { in: ['meta-office'] } } },
      { phoneNumberId: null, conversation: { phoneNumberId: null } },
    ])
    expect(where.producerCodeId).toBeUndefined()

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

  describe('quoteOrigin', () => {
    const numbers = [{ phoneNumberId: 'meta-office' }, { phoneNumberId: 'meta-pe' }]

    it('keeps a branch admin to the quotes asked through their own numbers', async () => {
      const finder = setup({ phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) } })

      const where = await finder.quoteOrigin(7, {
        codeIds: [3, 9],
        chats: { codeIds: [3, 9], ownNumbers: ['meta-pe'], defaultNumber: 'meta-office' },
      })

      expect(where.OR).toEqual([
        { phoneNumberId: { in: ['meta-pe'] } },
        { phoneNumberId: null, conversation: { phoneNumberId: { in: ['meta-pe'] } } },
      ])
    })

    it('gives the SuperAdmin every number of the codes, or only the one filtered by', async () => {
      const finder = setup({ phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) } })

      const all = await finder.quoteOrigin(7, { codeIds: [3, 9], chats: { codeIds: [3, 9], ownNumbers: null } })
      expect(all.OR?.[0]).toEqual({ phoneNumberId: { in: ['meta-office', 'meta-pe'] } })

      const one = await finder.quoteOrigin(7, {
        codeIds: [3, 9],
        chats: { codeIds: [3, 9], ownNumbers: null, filterNumber: 'meta-pe', defaultNumber: 'meta-office' },
      })
      expect(one.OR).toEqual([
        { phoneNumberId: { in: ['meta-pe'] } },
        { phoneNumberId: null, conversation: { phoneNumberId: { in: ['meta-pe'] } } },
      ])
    })

    it('shows nothing to an admin without a number of their own', async () => {
      const finder = setup({ phoneNumber: { findMany: jest.fn().mockResolvedValue(numbers) } })

      const where = await finder.quoteOrigin(7, { codeIds: [3], chats: { codeIds: [3], ownNumbers: [] } })

      expect(where.OR?.[0]).toEqual({ phoneNumberId: { in: [] } })
    })
  })
})
