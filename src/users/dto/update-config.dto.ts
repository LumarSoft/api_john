import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateConfigDto {
  /** Bot display name. Empty string clears it (bot falls back to "el asistente de JPMG"). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  botName?: string

  /** First names of the office people customers write to by name. Empty array clears them. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  staffNames?: string[]
}
