import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { QuoteVehicleDto } from './quote-vehicle.dto'

/**
 * A quote the bot asks for: the vehicle plus the chat it came from and the
 * vehicle as the bot named it, so an unfinished quote can be followed up
 * (sales campaign QUOTE_FOLLOWUP). Only the bot's endpoint takes them.
 */
export class BotQuoteVehicleDto extends QuoteVehicleDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number

  @IsOptional()
  @IsString()
  @MaxLength(160)
  vehicleLabel?: string
}
