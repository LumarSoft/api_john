import { IsBoolean } from 'class-validator'

export class SetQuoteFallbackDto {
  /** True: quote with the default organization's Triunfo account while this one has none of its own. */
  @IsBoolean()
  enabled: boolean
}
