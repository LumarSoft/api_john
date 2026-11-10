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
        detail: 'Cobertura A (sin robo, granizo y cristales)',
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
      .mockResolvedValueOnce([])
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

    expect(found.detail).toBe('Cobertura A (sin robo, granizo y cristales) · vigente desde 04/11/2026')
    expect(found.gaps).toEqual(['robo', 'granizo', 'cristales'])
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
    expect(found[0].detail).toBe('Tiene auto y moto · le falta: hogar, vida · vigente desde 01/10/2026')
    expect(found[0].gaps).toEqual(['home', 'life'])
  })

  it('offers only the products the organization sells, to who lacks them in the whole organization', async () => {
    const findMany = jest
      .fn()
      // In the user's codes: one client with a home policy, another with a car.
      .mockResolvedValueOnce([
        policy({ id: 1, riskType: 'home', vehicle: null }),
        policy({ id: 2, clientId: 61, client: { ...policy().client, id: 61 } }),
      ])
      // In the whole organization the second one also has a home policy, under another code.
      .mockResolvedValueOnce([{ clientId: 61, riskType: 'home' }])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(
      CAMPAIGNS.cross_sell,
      settingsOf(CAMPAIGNS.cross_sell, { offer: ['home', 'vehicle'] }),
      7,
      scopeOf([3]),
      NOW,
    )

    expect(found.map(f => [f.id, f.gaps])).toEqual([[1, ['vehicle']]])
    expect(found[0].detail).toBe('Tiene hogar · le falta: auto o moto')
  })

  it('lists a vehicle insured for less than the sum the office reviews, whatever its coverage', async () => {
    const findMany = jest.fn().mockResolvedValue([
      policy({
        vehicle: {
          licensePlate: 'AB123CD',
          brand: 'FORD',
          model: 'KA',
          year: 2015,
          coverage: 'C2',
          sumInsured: 3200000,
        },
      }),
    ])
    const finder = setup({ policy: { findMany } })

    const [found] = await finder.find(
      CAMPAIGNS.coverage_upgrade,
      settingsOf(CAMPAIGNS.coverage_upgrade, { reviewSumBelow: 5000000 }),
      7,
      scopeOf([3]),
      NOW,
    )

    expect(findMany.mock.calls[0][0].where.vehicle).toEqual({
      OR: [{ coverage: { in: ['A', 'B', 'B1', 'C2', 'C2 Full'] } }, { sumInsured: { gt: 0, lt: 5000000 } }],
    })
    expect(found.gaps).toEqual(['suma'])
    expect(found.detail).toBe('Cobertura C2 · se puede pasar a C Full · suma asegurada $ 3.200.000')
  })

  it('says what to offer a car on C Full, and nothing of the kind to a motorbike', async () => {
    const vehicle = { licensePlate: 'AB123CD', brand: 'FORD', model: 'KA', year: 2015, coverage: 'C2 Full' }
    const findMany = jest.fn().mockResolvedValue([policy({ vehicle }), policy({ id: 101, riskType: 'moto', vehicle })])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(
      CAMPAIGNS.coverage_upgrade,
      settingsOf(CAMPAIGNS.coverage_upgrade, null),
      7,
      scopeOf([3]),
      NOW,
    )

    expect(found.map(f => f.detail)).toEqual([
      'Cobertura C2 Full · se puede pasar a Todo Riesgo (D3)',
      'Cobertura C2 Full',
    ])
  })

  it('wins back a policy that ran out unrenewed, unless the office hid it or the vehicle is insured again', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        policy({ id: 5, validTo: new Date('2026-10-15T00:00:00Z') }),
        policy({ id: 6, clientId: 61, validTo: new Date('2026-10-20T00:00:00Z') }),
      ])
      .mockResolvedValueOnce([
        {
          id: 60,
          clientId: 61,
          riskType: 'auto',
          validTo: new Date('2027-10-20'),
          vehicle: { licensePlate: 'AB123CD' },
        },
      ])
    const finder = setup({ policy: { findMany } })

    const found = await finder.find(CAMPAIGNS.winback, settingsOf(CAMPAIGNS.winback, null), 7, scopeOf([3]), NOW)

    expect(findMany.mock.calls[1][0].where).toEqual(
      expect.objectContaining({ hiddenAt: null, validTo: { gte: expect.any(Date), lt: NOW } }),
    )
    expect(found.map(f => [f.id, f.reason, f.detail])).toEqual([
      [5, 'no_renovada', 'Venció el 15/10/2026 y no se renovó'],
    ])
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
      result: null,
      quoteRequest: null,
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
    expect(where.AND[0].OR).toEqual([
      { phoneNumberId: { in: ['meta-office'] } },
      { phoneNumberId: null, conversation: { phoneNumberId: { in: ['meta-office'] } } },
      { phoneNumberId: null, conversation: { phoneNumberId: null } },
      { phoneNumberId: null, conversationId: null },
    ])
    expect(where.producerCodeId).toBeUndefined()

    expect(found).toEqual([
      expect.objectContaining({
        id: 11,
        name: 'Laura',
        firstName: 'Laura',
        waId: '549341000001',
        bien: 'Volkswagen Gol',
        detail: 'Cotizó el 01/11/2026 · Triunfo',
      }),
    ])
  })

  it('follows up a request to contract that got no policy, with its price, unless the office closed it', async () => {
    const request = (status: string, document: string) => ({
      status,
      selectedCoverage: 'C2',
      applicantFirstName: 'MARIA',
      applicantLastName: 'LOPEZ',
      applicantPhone: '341159990003',
      applicantDocNumber: document,
      createdAt: new Date('2026-10-30T15:00:00Z'),
      deletedAt: null,
    })
    const price = (code: string, value: string) => ({ FormaPagoCod: code, ValorCuota: value })
    const web = (id: number, quoteRequest: ReturnType<typeof request>) => ({
      id,
      createdAt: new Date('2026-10-30T12:00:00Z'),
      vehicleType: 'AUTO',
      vehicleLabel: null,
      manufactureYear: 2020,
      producerCodeId: 3,
      producerCode: { id: 3, code: '11425' },
      result: {
        SDTSrvCotizacionOut: {
          Coberturas: [
            { Resultado: { Estado: 'S' }, Cotizaciones: [price('1', '52000.50'), price('6', '30000')] },
            { Resultado: { Estado: 'S' }, Cotizaciones: price('9', '48900') },
            { Resultado: { Estado: 'N' }, Cotizaciones: [price('1', '100')] },
          ],
        },
      },
      quoteRequest,
      conversation: null,
    })
    const finder = setup({
      phoneNumber: { findMany: jest.fn().mockResolvedValue([{ phoneNumberId: 'meta-office' }]) },
      quote: {
        findMany: jest
          .fn()
          .mockResolvedValue([web(31, request('NEW', '27.999.003')), web(32, request('CLOSED', '27999004'))]),
      },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      policy: { findMany: jest.fn().mockResolvedValue([]) },
    })

    const found = await finder.find(
      CAMPAIGNS.quote_followup,
      settingsOf(CAMPAIGNS.quote_followup, null),
      7,
      scopeOf([3]),
      NOW,
    )

    expect(found).toEqual([
      expect.objectContaining({
        id: 31,
        name: 'Maria Lopez',
        firstName: 'Maria',
        dni: '27999003',
        phone: '341159990003',
        waId: null,
        amount: 48900,
        company: 'Triunfo',
        detail: 'Pidió contratar el 30/10/2026 (cobertura C2) y no tiene póliza · Triunfo · cuotas desde $ 48.900',
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
