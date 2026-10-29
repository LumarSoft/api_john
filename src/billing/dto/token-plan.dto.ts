import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

/**
 * A plan of the catalog: a name, a size in tokens and the price the organization
 * sells it for. The size costs the organization the fixed unit price; a price
 * left out means "at cost", and one below cost is refused.
 */
export class CreateTokenPlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  tokens: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}

export class UpdateTokenPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  tokens?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}
