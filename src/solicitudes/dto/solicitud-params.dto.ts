import { Type } from 'class-transformer'
import { IsIn, IsInt, Min } from 'class-validator'
import { LEAD_KINDS } from '../solicitudes.types'

export class SolicitudParamsDto {
  @IsIn(LEAD_KINDS)
  kind: (typeof LEAD_KINDS)[number]

  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number
}
