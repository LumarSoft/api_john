import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export enum PagoEstadoFilter {
  CON_DEUDA = 'con_deuda',
  RECHAZADO = 'rechazado',
  AL_DIA = 'al_dia',
}

export class ListPagosDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsEnum(PagoEstadoFilter)
  estado?: PagoEstadoFilter

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
