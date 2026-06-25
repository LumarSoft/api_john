import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateConfigDto {
  /** Bot display name. Empty string clears it (bot falls back to "el asistente de JPMG"). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  botName?: string
}
