import { IsIn } from 'class-validator'
import { CAMPAIGN_KINDS, type CampaignKind } from '../campaign-catalog'

export class CampaignKindParamDto {
  @IsIn(CAMPAIGN_KINDS)
  kind: CampaignKind
}
