import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import { SancorBotQuotesService, accidentAgeRange } from './sancor-bot-quotes.service'
import type { SancorService } from './sancor.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { ConfigService } from '@nestjs/config'
import type { SancorProductPlan } from './sancor.types'

const LOCATION = { cityId: 1240, zipCode: 2000 }

function plan(module: number, monthly: number, coverages: Array<[string, number]>): SancorProductPlan {
  const lines = coverages.map(([description, capital]) => ({
    description,
    capital,
    monthlyPremium: 0,
    termPremium: 0,
    type: 'Cobertura',
  }))
  return { module, monthlyPremium: monthly, termPremium: monthly * 12, coverages: lines, lines }
}

function setup(env: Record<string, string> = {}, { enabled = true, missing = [] as string[] } = {}) {
  const sancor = {
    missingFor: jest.fn().mockReturnValue(missing),
    resolveLocation: jest.fn().mockResolvedValue(LOCATION),
    getModules: jest.fn().mockResolvedValue([]),
    quoteBag: jest.fn(),
    quoteBicycle: jest.fn(),
    quoteHomeProtected: jest.fn(),
    quotePersonalAccident: jest.fn(),
  }
  const prisma = {
    conversation: {
      findFirst: jest.fn().mockResolvedValue({ producer: { slug: 'john', sancorQuotesEnabled: enabled } }),
    },
  }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  const service = new SancorBotQuotesService(
    prisma as unknown as PrismaService,
    sancor as unknown as SancorService,
    config,
  )
  return { service, sancor, prisma }
}

describe('SancorBotQuotesService.productsFor', () => {
  it('offers the four products when the organization switched Sancor on', async () => {
    const { service, sancor } = setup()
    await expect(service.productsFor(10)).resolves.toEqual({ productTypes: ['bolso', 'hogar', 'bici', 'personas'] })
    expect(sancor.missingFor).toHaveBeenCalledWith('john')
  })

  it('offers nothing while the switch is off', async () => {
    await expect(setup({}, { enabled: false }).service.productsFor(10)).resolves.toEqual({ productTypes: [] })
  })

  it('offers nothing while the organization lacks Sancor credentials, even switched on', async () => {
    const { service } = setup({}, { missing: ['Falta el código de productor de Sancor.'] })
    await expect(service.productsFor(10)).resolves.toEqual({ productTypes: [] })
  })

  it('answers 404 for an unknown conversation', async () => {
    const { service, prisma } = setup()
    prisma.conversation.findFirst.mockResolvedValue(null)
    await expect(service.productsFor(10)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('SancorBotQuotesService.quote', () => {
  it('refuses to quote for an organization that is not enabled', async () => {
    const { service, sancor } = setup({}, { enabled: false })
    await expect(service.quote(10, { productType: 'bolso', zipCode: 2000 })).rejects.toBeInstanceOf(NotFoundException)
    expect(sancor.resolveLocation).not.toHaveBeenCalled()
  })

  it('quotes every bag module and returns the plans cheapest first, named as Sancor names them', async () => {
    const { service, sancor } = setup()
    sancor.getModules.mockResolvedValue([
      { id: 1, description: 'Plan 2000' },
      { id: 2, description: 'Plan 2600' },
    ])
    sancor.quoteBag.mockResolvedValue({
      quotationId: 99,
      plans: [plan(2, 39.4, [['Objetos Diversos', 2600]]), plan(1, 30, [['Objetos Diversos', 2000]])],
    })

    const quote = await service.quote(10, { productType: 'bolso', zipCode: 2000, cityName: 'Rosario' })

    expect(sancor.resolveLocation).toHaveBeenCalledWith(2000, 'Rosario')
    expect(sancor.getModules).toHaveBeenCalledWith('bag')
    expect(sancor.quoteBag).toHaveBeenCalledWith(LOCATION, [1, 2])
    expect(quote).toEqual({
      insurer: 'Sancor',
      zipCode: 2000,
      quotationId: 99,
      plans: [
        {
          id: 1,
          productType: 'bolso',
          name: 'Plan $2.000',
          monthlyPrice: 30,
          description: null,
          coverageItems: [{ label: 'Objetos Diversos', amount: 2000 }],
          isActive: true,
          sortOrder: 0,
        },
        expect.objectContaining({ id: 2, name: 'Plan $2.600', monthlyPrice: 39, sortOrder: 1 }),
      ],
    })
  })

  it('drops the revision month from home plan names and lists coverages without capital as included', async () => {
    const { service, sancor } = setup()
    sancor.getModules.mockResolvedValue([
      { id: 70, description: 'Plan 1 - AGOSTO 2026' },
      { id: 71, description: 'Plan 2 - AGOSTO 2026' },
    ])
    sancor.quoteHomeProtected.mockResolvedValue({
      plans: [
        plan(70, 7630, [
          ['Incendio Edificio', 21_000_000],
          ['Asistencia en viaje a las Personas', 0],
          ['Llamando al Doctor', 1],
        ]),
      ],
    })

    const quote = await service.quote(10, { productType: 'hogar', zipCode: 2000 })

    expect(sancor.quoteHomeProtected).toHaveBeenCalledWith(LOCATION, [70, 71])
    expect(quote.quotationId).toBeNull()
    expect(quote.plans).toEqual([
      expect.objectContaining({
        name: 'Plan 1',
        description: 'Incluye asistencia en viaje a las personas, llamando al doctor',
        coverageItems: [{ label: 'Incendio Edificio', amount: 21_000_000 }],
      }),
    ])
  })

  it('quotes the bicycle without modules and names its plans from the catalog', async () => {
    const { service, sancor } = setup()
    sancor.getModules.mockResolvedValue([{ id: 1, description: 'Plan 25.000' }])
    sancor.quoteBicycle.mockResolvedValue({ plans: [plan(1, 380, [['Objetos Diversos', 25_000]])] })

    const quote = await service.quote(10, { productType: 'bici', zipCode: 2000 })

    expect(sancor.getModules).toHaveBeenCalledWith('bicycle')
    expect(sancor.quoteBicycle).toHaveBeenCalledWith(LOCATION)
    expect(quote.plans[0]).toEqual(expect.objectContaining({ id: 1, name: 'Plan $25.000', monthlyPrice: 380 }))
  })

  it('quotes personal accidents once per offered capital with the DNI and the age range', async () => {
    const { service, sancor } = setup({ SANCOR_AP_MODULES: '47,60,999' })
    sancor.getModules.mockResolvedValue([
      { id: 32, description: 'Módulo $7.000.000' },
      { id: 47, description: 'Módulo $8.000.000' },
      { id: 60, description: 'Módulo $10.000.000' },
    ])
    sancor.quotePersonalAccident.mockImplementation(({ module }: { module: number }) =>
      Promise.resolve({ quotationId: module, plans: [plan(module, module * 100, [['Muerte', 8_000_000]])] }),
    )

    const quote = await service.quote(10, {
      productType: 'personas',
      zipCode: 2000,
      documentNumber: 20999001,
      birthDate: '01/01/1950',
    })

    expect(sancor.getModules).toHaveBeenCalledWith('accidentespersonales/24')
    expect(sancor.quotePersonalAccident).toHaveBeenCalledTimes(2)
    expect(sancor.quotePersonalAccident).toHaveBeenCalledWith({
      location: LOCATION,
      module: 47,
      document: { number: 20999001, type: 'D' },
      ageRange: '76+',
    })
    expect(quote.plans.map(p => p.name)).toEqual(['Capital $8.000.000', 'Capital $10.000.000'])
  })

  it('asks for the DNI before quoting personal accidents', async () => {
    const { service, sancor } = setup()
    await expect(service.quote(10, { productType: 'personas', zipCode: 2000 })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(sancor.quotePersonalAccident).not.toHaveBeenCalled()
  })

  it('passes an unknown postal code on as a 400 and a Sancor failure as a 502', async () => {
    const { service, sancor } = setup()
    sancor.resolveLocation.mockRejectedValueOnce(new BadRequestException('sin localidades'))
    await expect(service.quote(10, { productType: 'bolso', zipCode: 9999 })).rejects.toBeInstanceOf(BadRequestException)

    sancor.quoteBag.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(service.quote(10, { productType: 'bolso', zipCode: 2000 })).rejects.toBeInstanceOf(BadGatewayException)
  })
})

describe('accidentAgeRange', () => {
  const now = new Date(2026, 10, 9)

  it('reads the age from a DD/MM/AAAA birth date', () => {
    expect(accidentAgeRange('15/04/1985', now)).toBe('16-70')
    expect(accidentAgeRange('10/11/1955', now)).toBe('16-70')
    expect(accidentAgeRange('09/11/1955', now)).toBe('71-75')
    expect(accidentAgeRange('1-2-1950', now)).toBe('76+')
  })

  it('falls back to 16 to 70 when there is no date to read', () => {
    expect(accidentAgeRange(undefined, now)).toBe('16-70')
    expect(accidentAgeRange('no sé', now)).toBe('16-70')
  })
})
