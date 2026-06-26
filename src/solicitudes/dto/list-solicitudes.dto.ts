import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ALL_PRODUCT_TYPES, LEAD_KINDS, LEAD_STATUSES } from '../solicitudes.types'

export class ListSolicitudesDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number]

  @IsOptional()
  @IsIn(ALL_PRODUCT_TYPES)
  productType?: (typeof ALL_PRODUCT_TYPES)[number]

  @IsOptional()
  @IsIn(LEAD_KINDS)
  kind?: (typeof LEAD_KINDS)[number]

  // Matches contact name, phone or email (case-insensitive).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerCodeId?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
