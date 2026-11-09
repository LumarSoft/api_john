import { Type } from 'class-transformer'
import { IsIn, IsInt, Min } from 'class-validator'
import { CAMPAIGN_KINDS, type CampaignKind } from '../campaign-catalog'

/** One client of a campaign, by the id the list gives (a policy, or a quote in `quote_followup`). */
export class OpportunityTargetParamDto {
  @IsIn(CAMPAIGN_KINDS)
  kind: CampaignKind

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId: number
}
