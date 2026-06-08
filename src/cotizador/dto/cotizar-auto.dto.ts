import { IsInt, IsString, Min, Max, IsOptional } from 'class-validator'

export class CotizarAutoDto {
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
