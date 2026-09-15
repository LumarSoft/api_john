import { CotizadorService } from './cotizador.service'
import { VehicleType } from '../infoauto/infoauto.types'

describe('CotizadorService motorcycle availability', () => {
  it('does not ask Triunfo for a token when the motorcycle catalog is unavailable', async () => {
    const getAuth = jest.fn()
    const service = new CotizadorService(
      {} as any,
      {} as any,
      { getAuth } as any,
      { isAvailable: jest.fn().mockReturnValue(false) } as any,
      {} as any,
      {} as any,
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
