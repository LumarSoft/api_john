import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export enum CobranzaEstadoFilter {
  VENCIDAS = 'vencidas',
  RECHAZADAS = 'rechazadas',
  PENDIENTES = 'pendientes',
  TODAS = 'todas',
}

export class ListCobranzasDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @IsEnum(CobranzaEstadoFilter)
  estado?: CobranzaEstadoFilter

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
