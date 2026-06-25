import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, MaxLength, Min, IsString } from 'class-validator'

export enum NovedadType {
  SINIESTRO = 'siniestro',
  HANDOFF = 'handoff',
}

export class ListNovedadesDto {
  @IsOptional()
  @IsEnum(NovedadType)
  type?: NovedadType

  // When true, returns only unread novedades (readAt is null).
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean

  // Matches the linked client's first/last name or DNI.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  // Restrict to a single client's novedades.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  clientId?: number

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

export class MarkAllReadDto {
  // Restrict the "mark all read" action to a single category when provided.
  @IsOptional()
  @IsEnum(NovedadType)
  type?: NovedadType
}
