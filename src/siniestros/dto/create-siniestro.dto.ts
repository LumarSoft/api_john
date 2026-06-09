import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator'

export const SINIESTRO_TIPOS = ['auto', 'hogar', 'robo', 'otro'] as const
export type SiniestroTipo = (typeof SINIESTRO_TIPOS)[number]

export class CreateSiniestroDto {
  @IsIn(SINIESTRO_TIPOS)
  tipo: SiniestroTipo

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  descripcion: string

  // ISO date of the incident (e.g. "2026-06-01")
  @IsDateString()
  fecha: string

  // Sent as a string over multipart/form-data; coerced to number.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  polizaId: number
}
