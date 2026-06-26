import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { RiskType } from 'generated/prisma/client'

export enum ClientEstadoFilter {
  VIGENTE = 'vigente',
  POR_VENCER = 'por_vencer',
  VENCIDA = 'vencida',
  SIN_POLIZAS = 'sin_polizas',
}

export enum ClientSort {
  NOMBRE_ASC = 'nombre_asc',
  NOMBRE_DESC = 'nombre_desc',
  RECIENTE = 'reciente',
}

export class ListClientsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @IsEnum(RiskType)
  riskType?: RiskType

  @IsOptional()
  @IsEnum(ClientEstadoFilter)
  estado?: ClientEstadoFilter

  @IsOptional()
  @IsEnum(ClientSort)
  sort?: ClientSort

  // SuperAdmin/admin "filter by código" selector (must be an accessible code).
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
