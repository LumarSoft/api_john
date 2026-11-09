import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator'
import { CAMPAIGN_KINDS, CampaignKind } from '../campaign-catalog'

/** The period and scope of the campaigns' results. Without dates: the last 90 days. */
export class CampaignResultsDto {
  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  kind?: CampaignKind

  /** ISO day or instant the period starts at (inclusive). */
  @IsOptional()
  @IsDateString()
  from?: string

  /** ISO day or instant the period ends at (inclusive). */
  @IsOptional()
  @IsDateString()
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerCodeId?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  phoneNumberId?: number

  /** Only the opportunities this person follows. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedToId?: number
}
