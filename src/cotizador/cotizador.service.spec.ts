import { CotizadorService } from './cotizador.service'
import { VehicleType } from '../infoauto/infoauto.types'
import type { HttpService } from '@nestjs/axios'
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
