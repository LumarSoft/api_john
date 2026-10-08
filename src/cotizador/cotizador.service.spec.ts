import { of } from 'rxjs'
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
    )
    const result = await service.quoteVehicle(
      VehicleType.MOTO,
      { brand: '881', model: '8810215', manufactureYear: 2025, postalCode: 2000 },
      1,
      null,
    )
    expect(result.coverages.map(c => c.code)).toEqual(codes.filter(c => ['A', 'B4', 'B1'].includes(c)))
    expect(settings.apply).toHaveBeenCalledWith(1, expect.any(Array), 2025, ['A', 'B4', 'B1'], VehicleType.MOTO)
    expect(result.messages.some(message => message.includes('cobertura B4.'))).toBe(!codes.includes('B4'))
  })
})
