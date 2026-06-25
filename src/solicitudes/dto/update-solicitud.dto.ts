import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { LEAD_STATUSES } from '../solicitudes.types'

export class UpdateSolicitudDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number]

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
