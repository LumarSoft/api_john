import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { ClaimStatus } from './list-siniestros.dto'

// Admin update after handling the claim manually in Triunfo's web:
// progress the internal state and/or record the official claim number.
export class UpdateSiniestroDto {
  @IsOptional()
  @IsEnum(ClaimStatus)
  estado?: ClaimStatus

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nroSiniestroCompania?: string
}
