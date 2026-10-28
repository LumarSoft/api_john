import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

/** A plan of the catalog: a name and a size in tokens; the price follows the fixed unit price. */
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
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}

/** The plan a number moves to; null puts it back on the organization's smallest. */
export class SetNumberPlanDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId?: number | null
}
