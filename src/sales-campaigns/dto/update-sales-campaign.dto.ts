import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/** What the office changes of a campaign; anything left out stays as it was. */
export class UpdateSalesCampaignDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  /** The discount the message offers ({porcentaje}). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number

  /** A new text goes to Meta's review before the campaign can send it. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  body?: string

  /** The campaign's own settings, checked against its fields (campaign-catalog.ts). */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>
}
