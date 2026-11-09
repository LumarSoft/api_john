import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * The customer changed their mind during the take-out documents ("mejor una
 * responsabilidad civil"): the bot moves the request it already created to the
 * coverage they want now, instead of opening a second one.
 */
export class UpdateBotLeadCoverageDto {
  /** "A — Responsabilidad Civil", as the bot labels the chosen coverage. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  cobertura: string

  /** Monthly price shown for it, when known ("$ 67.825 por mes"). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  precio?: string
}
