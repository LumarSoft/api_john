import { IsInt, IsString, Min, Max, IsOptional, Matches } from 'class-validator'

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

  @IsInt()
  postalCode: number

  @IsOptional()
  @IsString()
  coverage?: string
}
