import { IsBoolean, IsInt, IsString, Min, Max, IsOptional, Matches } from 'class-validator'

// Same shape for every vehicle line (auto, moto). The line is taken from the
// route segment, not the body.
export class QuoteVehicleDto {
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'brand must be a positive integer string' })
  brand: string

  @IsString()
  @Matches(/^[1-9]\d{4,}$/, { message: 'model must be a valid positive CODIA' })
  model: string

  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear() + 1)
  manufactureYear: number

  // Argentine postal codes run from 1000 to the 9400s. Triunfo prices an
  // unknown one instead of rejecting it: 9999 came back at half the Rosario RC.
  @IsInt()
  @Min(1000, { message: 'El código postal tiene que tener 4 dígitos.' })
  @Max(9499, { message: 'Ese código postal no existe. Revisá los 4 dígitos.' })
  postalCode: number

  /** Brand new and not registered yet: Triunfo prices the casco differently. */
  @IsOptional()
  @IsBoolean()
  zeroKm?: boolean

  /** Cars only. Not priced yet (see GNC_NOT_PRICED_MESSAGE), recorded for the office. */
  @IsOptional()
  @IsBoolean()
  hasGnc?: boolean

  @IsOptional()
  @IsString()
  coverage?: string
}
