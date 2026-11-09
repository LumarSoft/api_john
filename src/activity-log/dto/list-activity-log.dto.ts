import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsInt, IsIP, IsOptional, Max, Min } from 'class-validator'

export class ListActivityLogDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerId?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number

  @IsOptional()
  @IsIP()
  ip?: string

  /** Only what was rejected (status 400 or more): failed logins, forbidden actions. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  failed?: boolean

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number
}
