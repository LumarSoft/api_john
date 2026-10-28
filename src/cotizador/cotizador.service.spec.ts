import { AxiosError } from 'axios'
import { of, throwError } from 'rxjs'
import { CotizadorService } from './cotizador.service'
import { VehicleType } from '../infoauto/infoauto.types'
import type { HttpService } from '@nestjs/axios'
import type { NovedadesService } from '../novedades/novedades.service'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { TriunfoService } from '../triunfo/triunfo.service'
import type { InfoAutoService } from '../infoauto/infoauto.service'
import type { CoverageSettingsService } from '../coverage-settings/coverage-settings.service'

describe('CotizadorService motorcycle availability', () => {
  it('does not ask Triunfo for a token when the motorcycle catalog is unavailable', async () => {
    const getAuth = jest.fn()
    const service = new CotizadorService(
      {} as HttpService,
      {} as PrismaService,
      { getAuth } as unknown as TriunfoService,
      { isAvailable: jest.fn().mockReturnValue(false) } as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )

    await expect(
      service.quoteVehicle(
        VehicleType.MOTO,
        { brand: '980', model: '9800005', manufactureYear: 2023, postalCode: 2000 },
        null,
        null,
      ),
    ).rejects.toMatchObject({ status: 503 })
    expect(getAuth).not.toHaveBeenCalled()
  })
})

describe('CotizadorService vehicle code validation', () => {
  const createService = () => {
    const triunfo = { getAuth: jest.fn() }
    const infoAuto = { isAvailable: jest.fn().mockReturnValue(true) }
    const service = new CotizadorService(
      {} as HttpService,
      {} as PrismaService,
      triunfo as unknown as TriunfoService,
      infoAuto as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
    return { service, triunfo }
  }

  it('rejects codia 0 before asking Triunfo for a token', async () => {
    const { service, triunfo } = createService()

    await expect(
      service.quoteVehicle(
        VehicleType.AUTO,
        { brand: '0', model: '0', manufactureYear: 2024, postalCode: 2000 },
        null,
        null,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(triunfo.getAuth).not.toHaveBeenCalled()
  })

  it('rejects a CODIA that does not belong to the supplied brand', async () => {
    const { service, triunfo } = createService()

    await expect(
      service.quoteVehicle(
        VehicleType.AUTO,
        { brand: '18', model: '120657', manufactureYear: 2024, postalCode: 2000 },
        null,
        null,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(triunfo.getAuth).not.toHaveBeenCalled()
  })

  it('accepts the verified Chevrolet Onix brand/CODIA combination', async () => {
    const getAuth = jest.fn()
    const service = new CotizadorService(
      {} as HttpService,
      {} as PrismaService,
      { getAuth } as unknown as TriunfoService,
      { isAvailable: jest.fn().mockReturnValue(false) } as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )

    await expect(
      service.quoteVehicle(
        VehicleType.AUTO,
        { brand: '12', model: '120632', manufactureYear: 2024, postalCode: 2000 },
        null,
        null,
      ),
    ).rejects.toMatchObject({ status: 503 })
    expect(getAuth).not.toHaveBeenCalled()
  })
})

describe('CotizadorService model year guard', () => {
  it('stops an invalid Palio year before contacting Triunfo', async () => {
    const getAuth = jest.fn()
    const validateVehicleYear = jest.fn().mockRejectedValue(new Error('Modelo y año inválidos'))
    const service = new CotizadorService(
      {} as HttpService,
      {} as PrismaService,
      { getAuth } as unknown as TriunfoService,
      { isAvailable: () => true, validateVehicleYear } as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
    await expect(
      service.quoteVehicle(
        VehicleType.AUTO,
        { brand: '17', model: '170001', manufactureYear: 2024, postalCode: 2000 },
        null,
        null,
      ),
    ).rejects.toThrow('Modelo y año inválidos')
    expect(validateVehicleYear).toHaveBeenCalledWith(VehicleType.AUTO, 17, 170001, 2024)
    expect(getAuth).not.toHaveBeenCalled()
  })
})

describe('CotizadorService motorcycle offers', () => {
  it.each([
    ['A', 'B', 'B1', 'B4'],
    ['A', 'B1'],
  ])('offers required codes and reports absent prices: %j', async (...codes: string[]) => {
    const http = {
      post: jest.fn().mockReturnValue(
        of({
          data: {
            SDTSrvCotizacionOut: {
              Coberturas: codes.map(code => ({
                Cobertura: code,
                Resultado: { Estado: 'S' },
                Cotizaciones: [{ FormaPagoCod: '1', Premio: '1000', ValorCuota: '1000', Cuotas: 1 }],
              })),
            },
          },
        }),
      ),
    }
    const settings = {
      registerDiscovered: jest.fn().mockResolvedValue(undefined),
      apply: jest.fn().mockImplementation(async (_producer, coverages) => coverages),
    }
    const service = new CotizadorService(
      http as unknown as HttpService,
      {} as PrismaService,
      { getAuth: jest.fn().mockResolvedValue({}) } as unknown as TriunfoService,
      {
        isAvailable: () => true,
        validateVehicleYear: jest.fn().mockResolvedValue(undefined),
        getVehicleValue: jest.fn().mockResolvedValue(null),
        getVehicleOrigin: jest.fn().mockResolvedValue('N'),
      } as unknown as InfoAutoService,
      settings as unknown as CoverageSettingsService,
      { getOrThrow: () => 'https://triunfo.test' } as unknown as ConfigService,
      {} as NovedadesService,
    )
    const result = await service.quoteVehicle(
      VehicleType.MOTO,
      { brand: '881', model: '8810215', manufactureYear: 2025, postalCode: 2000 },
      1,
      null,
    )
    expect(result.coverages.map(c => c.code)).toEqual(codes.filter(c => ['A', 'B4', 'B1', 'B'].includes(c)))
    expect(settings.apply).toHaveBeenCalledWith(
      1,
      expect.any(Array),
      2025,
      ['A', 'B4', 'B1', 'B'],
      VehicleType.MOTO,
      null,
    )
    expect(result.messages.some(message => message.includes('cobertura B4.'))).toBe(!codes.includes('B4'))
    expect(result.messages.some(message => message.includes('cobertura B.'))).toBe(!codes.includes('B'))
  })
})

describe('CotizadorService Triunfo timeout', () => {
  function createService(post: jest.Mock) {
    return new CotizadorService(
      { post } as unknown as HttpService,
      {} as PrismaService,
      { getAuth: jest.fn().mockResolvedValue({}), baseUrlSip: 'https://triunfo.test' } as unknown as TriunfoService,
      {
        isAvailable: () => true,
        validateVehicleYear: jest.fn().mockResolvedValue(undefined),
        getVehicleValue: jest.fn().mockResolvedValue(null),
        getVehicleOrigin: jest.fn().mockResolvedValue('N'),
      } as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
  }
  const dto = { brand: '12', model: '120236', manufactureYear: 2009, postalCode: 2000 }

  it('caps the quote request at 15 seconds', async () => {
    const post = jest
      .fn()
      .mockReturnValue(throwError(() => new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED')))

    await expect(createService(post).quoteVehicle(VehicleType.AUTO, dto, null, null)).rejects.toMatchObject({
      status: 504,
    })
    expect(post).toHaveBeenCalledWith(expect.stringContaining('RESTCotizadorAutV2'), expect.anything(), {
      timeout: 15_000,
    })
  })

  it('keeps answering 502 when Triunfo fails for another reason', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => new AxiosError('socket hang up', 'ECONNRESET')))

    await expect(createService(post).quoteVehicle(VehicleType.AUTO, dto, null, null)).rejects.toMatchObject({
      status: 502,
    })
  })
})

describe('CotizadorService vehicle Triunfo could not value', () => {
  const coverage = (code: string, valid: boolean) =>
    valid
      ? {
          Cobertura: code,
          Resultado: { Estado: 'S' },
          Cotizaciones: [{ FormaPagoCod: '1', Premio: '67825', ValorCuota: '67825', Cuotas: 1 }],
        }
      : {
          Cobertura: code,
          Resultado: {
            Estado: 'N',
            Mensajes: [{ Id: 'CoberturaNoValida', Type: 1, Description: `Cobertura ${code} no válida` }],
          },
          Cotizaciones: [],
        }

  async function quote(value: string, coberturas: unknown[], vehicleType = VehicleType.AUTO) {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          SDTSrvCotizacionOut: {
            Coberturas: coberturas,
            DatosAdicionales: [{ Codigo: '1', Nombre: 'ValorVehiculo', Valor: value }],
            Resultado: { Estado: 'S', Mensajes: [] },
          },
        },
      }),
    )
    const service = new CotizadorService(
      { post } as unknown as HttpService,
      {} as PrismaService,
      { getAuth: jest.fn().mockResolvedValue({}), baseUrlSip: 'https://triunfo.test' } as unknown as TriunfoService,
      {
        isAvailable: () => true,
        validateVehicleYear: jest.fn().mockResolvedValue(undefined),
        getVehicleValue: jest.fn().mockResolvedValue(null),
        getVehicleOrigin: jest.fn().mockResolvedValue('N'),
      } as unknown as InfoAutoService,
      {
        registerDiscovered: jest.fn().mockResolvedValue(undefined),
        apply: jest.fn().mockImplementation(async (_producer, coverages) => coverages),
      } as unknown as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
    const dto =
      vehicleType === VehicleType.AUTO
        ? { brand: '12', model: '120236', manufactureYear: 2009, postalCode: 2000 }
        : { brand: '881', model: '8810215', manufactureYear: 2016, postalCode: 2000 }
    return service.quoteVehicle(vehicleType, dto, 1, null)
  }

  it('flags a quote with no vehicle value and only Responsabilidad Civil priced', async () => {
    const result = await quote('            0.00', [
      coverage('A', true),
      ...['B', 'B1', 'C', 'D'].map(code => coverage(code, false)),
    ])
    expect(result.valuationMissing).toBe(true)
    expect(result.coverages.map(c => c.code)).toEqual(['A'])
    expect(result.messages.join(' ')).toContain('no pudo valuar el vehículo')
  })

  it('reports it once for a motorcycle instead of one notice per missing coverage', async () => {
    const result = await quote(
      '0.00',
      [coverage('A', true), coverage('B1', false), coverage('B4', false)],
      VehicleType.MOTO,
    )
    expect(result.valuationMissing).toBe(true)
    expect(result.messages).toHaveLength(1)
  })

  it('does not flag a valued vehicle', async () => {
    const result = await quote('      7800000.00', [coverage('A', true), coverage('B', true), coverage('D4', false)])
    expect(result.valuationMissing).toBe(false)
    expect(result.messages).toEqual([])
  })

  it('does not flag a zero value when other coverages were still priced', async () => {
    const result = await quote('0.00', [coverage('A', true), coverage('B1', true), coverage('D', false)])
    expect(result.valuationMissing).toBe(false)
  })
})

describe('CotizadorService 0 km and GNC', () => {
  function createService() {
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          SDTSrvCotizacionOut: {
            Coberturas: [
              {
                Cobertura: 'A',
                Resultado: { Estado: 'S' },
                Cotizaciones: [{ FormaPagoCod: '1', Premio: '67825', ValorCuota: '67825', Cuotas: 1 }],
              },
            ],
            DatosAdicionales: [{ Codigo: '1', Nombre: 'ValorVehiculo', Valor: '25000000.00' }],
            Resultado: { Estado: 'S', Mensajes: [] },
          },
        },
      }),
    )
    const validateVehicleYear = jest.fn().mockResolvedValue(undefined)
    const service = new CotizadorService(
      { post } as unknown as HttpService,
      {} as PrismaService,
      { getAuth: jest.fn().mockResolvedValue({}), baseUrlSip: 'https://triunfo.test' } as unknown as TriunfoService,
      {
        isAvailable: () => true,
        validateVehicleYear,
        getVehicleValue: jest.fn().mockResolvedValue(null),
        getVehicleOrigin: jest.fn().mockResolvedValue('N'),
      } as unknown as InfoAutoService,
      {
        registerDiscovered: jest.fn().mockResolvedValue(undefined),
        apply: jest.fn().mockImplementation(async (_producer, coverages) => coverages),
      } as unknown as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
    return { service, post, validateVehicleYear }
  }
  const year = new Date().getFullYear()
  const sentAutomotor = (post: jest.Mock) =>
    (post.mock.calls[0][1] as { SDTSrvCotizacionIn: { Automotor: Record<string, unknown> } }).SDTSrvCotizacionIn
      .Automotor

  it('tells Triunfo the vehicle is 0 km only when it is', async () => {
    const zero = createService()
    await zero.service.quoteVehicle(
      VehicleType.AUTO,
      { brand: '17', model: '170908', manufactureYear: year, postalCode: 2000, zeroKm: true },
      1,
      null,
    )
    expect(sentAutomotor(zero.post).CeroKM).toBe(1)

    const used = createService()
    await used.service.quoteVehicle(
      VehicleType.AUTO,
      { brand: '17', model: '170908', manufactureYear: year, postalCode: 2000 },
      1,
      null,
    )
    expect(sentAutomotor(used.post).CeroKM).toBe(0)
  })

  it('rejects a 0 km of an older model year before asking Triunfo', async () => {
    const { service, post, validateVehicleYear } = createService()
    await expect(
      service.quoteVehicle(
        VehicleType.AUTO,
        { brand: '17', model: '170908', manufactureYear: year - 3, postalCode: 2000, zeroKm: true },
        1,
        null,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(validateVehicleYear).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('says the price leaves the GNC equipment out, without sending a guessed accessory', async () => {
    const { service, post } = createService()
    const result = await service.quoteVehicle(
      VehicleType.AUTO,
      { brand: '17', model: '170908', manufactureYear: year, postalCode: 2000, hasGnc: true },
      1,
      null,
    )
    expect(result.messages.join(' ')).toContain('no incluye el equipo de GNC')
    expect(sentAutomotor(post).Accesorios).toEqual([])
  })
})

describe('CotizadorService bot quotes per organization', () => {
  function createService(phone: { producerId: number } | null) {
    const prisma = { phoneNumber: { findFirst: jest.fn().mockResolvedValue(phone) } }
    const triunfo = { getAuth: jest.fn().mockRejectedValue(new Error('stop after auth')) }
    const service = new CotizadorService(
      {} as HttpService,
      prisma as unknown as PrismaService,
      triunfo as unknown as TriunfoService,
      {
        isAvailable: () => true,
        validateVehicleYear: jest.fn().mockResolvedValue(undefined),
      } as unknown as InfoAutoService,
      {} as CoverageSettingsService,
      {} as ConfigService,
      {} as NovedadesService,
    )
    return { service, prisma, triunfo }
  }
  const dto = { brand: '12', model: '120236', manufactureYear: 2019, postalCode: 2000 }

  it("quotes with the Triunfo account of the number's organization", async () => {
    const { service, prisma, triunfo } = createService({ producerId: 2 })

    await expect(service.quoteVehicleForNumber('555', VehicleType.AUTO, dto)).rejects.toThrow('stop after auth')

    expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: { phoneNumberId: '555', isActive: true, deletedAt: null },
      select: { producerId: true, coverageSettings: true },
    })
    expect(triunfo.getAuth).toHaveBeenCalledWith(2)
  })

  it('refuses a number that is not registered', async () => {
    const { service, triunfo } = createService(null)
    await expect(service.quoteVehicleForNumber('999', VehicleType.AUTO, dto)).rejects.toMatchObject({ status: 404 })
    expect(triunfo.getAuth).not.toHaveBeenCalled()
  })

  it('keeps an anonymous web quote on the default organization', async () => {
    const { service, triunfo } = createService(null)
    await expect(service.quoteVehicle(VehicleType.AUTO, dto, null, null)).rejects.toThrow('stop after auth')
    expect(triunfo.getAuth).toHaveBeenCalledWith(null)
  })
})
