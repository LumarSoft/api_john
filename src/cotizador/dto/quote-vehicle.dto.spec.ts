import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { QuoteVehicleDto } from './quote-vehicle.dto'

const errorsFor = async (postalCode: number) =>
  (
    await validate(
      plainToInstance(QuoteVehicleDto, { brand: '12', model: '120236', manufactureYear: 2009, postalCode }),
    )
  ).filter(e => e.property === 'postalCode')

describe('QuoteVehicleDto postal code', () => {
  it.each([1001, 2000, 5000, 9410])('accepts the Argentine postal code %i', async code => {
    expect(await errorsFor(code)).toHaveLength(0)
  })

  // 9999 came back from Triunfo priced at half the Rosario liability.
  it.each([200, 999, 9999, 20000])('rejects %i, which is not a postal code', async code => {
    expect(await errorsFor(code)).toHaveLength(1)
  })
})
