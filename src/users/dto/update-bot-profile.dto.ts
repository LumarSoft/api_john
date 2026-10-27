import { IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

/**
 * What the bot says that is particular to the organization. Every field is
 * optional: only the ones sent change, and an empty string clears one.
 */
export class UpdateBotProfileDto {
  /** How the bot names the organization ("John Pellegrini Management Group"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  orgName?: string

  /** Short form shown next to it ("JPMG"). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  orgShortName?: string

  /** Legal name the model introduces itself with ("… SRL"). */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  orgLegalName?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  towTruckPhone?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  claimsPhone?: string

  /** Where cash is paid with the coupon ("Rapipago, Pago Fácil o Santa Fe Servicios"). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cashPaymentPlaces?: string

  @IsOptional()
  @IsString()
  @MaxLength(60)
  transferAlias?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  transferCbu?: string

  @IsOptional()
  @IsString()
  @MaxLength(160)
  transferHolder?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  transferBank?: string

  /** Who gets the e-mail of each new claim. */
  @IsOptional()
  @ValidateIf((dto: UpdateBotProfileDto) => !!dto.claimsEmail?.trim())
  @IsEmail()
  @MaxLength(254)
  claimsEmail?: string
}
