import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt } from 'class-validator'

/** The rows of a campaign's list an action applies to: policies, or quotes for the quote follow-up. */
export class CampaignIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids: number[]
}
