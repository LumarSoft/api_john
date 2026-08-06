import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

const MIN_VEHICLE_YEAR = 1900
const MAX_VEHICLE_YEAR = 2100

export class UpdateCoverageSettingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  tagline?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  benefits?: string[]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @IsBoolean()
  highlighted?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number

  // Vehicle-year window. Send null on both to make the coverage apply to every year.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_VEHICLE_YEAR)
  @Max(MAX_VEHICLE_YEAR)
  yearFrom?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_VEHICLE_YEAR)
  @Max(MAX_VEHICLE_YEAR)
  yearTo?: number | null
}
