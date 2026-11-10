import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { SANCOR_BOT_PRODUCT_TYPES, type SancorBotProductType } from '../sancor-bot-quotes.service'

/** A Sancor quotation the bot asks for a lead product. */
export class SancorBotQuoteDto {
  @IsIn(SANCOR_BOT_PRODUCT_TYPES)
  productType: SancorBotProductType

  // Argentine postal code (the numeric one: 2000, not S2000).
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(9999)
  zipCode: number

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cityName?: string

  // Personal accidents only: Sancor does not quote them without it.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000_000)
  @Max(99_999_999)
  documentNumber?: number

  // Personal accidents only, DD/MM/AAAA: sets the age range.
  @IsOptional()
  @Matches(/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/)
  birthDate?: string
}
