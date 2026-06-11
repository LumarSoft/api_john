import { IsInt, IsString, Min, Max, IsOptional } from 'class-validator'

// Same shape for every vehicle line (auto, moto). The line is taken from the
// route segment, not the body.
export class QuoteVehicleDto {
  @IsString()
  brand: string

  @IsString()
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
