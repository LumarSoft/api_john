import { Transform, Type } from 'class-transformer'
import { IsDateString, IsBoolean, IsEnum, IsInt, IsOptional, Max, MaxLength, Min, IsString } from 'class-validator'

export enum NovedadType {
  SINIESTRO = 'siniestro',
  HANDOFF = 'handoff',
  BAJA_POLIZA = 'baja_poliza',
  LEAD = 'lead',
  SOLICITUD = 'solicitud',
}

export enum MatterCategory {
  BAJA = 'baja',
  PAGOS = 'pagos',
  COTIZACION = 'cotizacion',
  SINIESTRO = 'siniestro',
  DOCUMENTOS = 'documentos',
  OTHER = 'other',
}
export enum MatterStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
}
export class UpdateMatterDto {
  @IsOptional()
  @IsEnum(MatterCategory)
  category?: MatterCategory
  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus
}
export class HandoffReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string
}
export class ListNovedadesDto {
  @IsOptional()
  @IsEnum(MatterCategory)
  category?: MatterCategory
  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  actionable?: boolean
  @IsOptional()
  @IsDateString()
  since?: string

  @IsOptional()
  @IsEnum(NovedadType)
  type?: NovedadType

  // When true, returns only unread novedades (readAt is null).
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean

  // Matches title/reason (including unlinked phone numbers), or client name/DNI.
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
  producerCodeId?: number

  // SuperAdmin "filter by número/sucursal" — a PhoneNumber id; resolves to the
  // producer codes that number serves.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  phoneNumberId?: number

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
