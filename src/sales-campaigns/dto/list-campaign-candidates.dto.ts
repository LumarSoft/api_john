import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CobranzasScopeDto } from '../../clients/dto/list-cobranzas.dto'
import { CANCELLATION_REASONS, type CancellationReason } from '../campaign-catalog'

export const CAMPAIGN_SORTS = ['recent', 'oldest'] as const
export type CampaignSort = (typeof CAMPAIGN_SORTS)[number]

/** Who a campaign finds, in the code or number the user picked, one page at a time. */
export class ListCampaignCandidatesDto extends CobranzasScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  /** A coverage code ("A", "C2 Full"): Mejora de coberturas and Venta cruzada. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  coverage?: string

  /** Why the policy was cancelled: Bajas y anulaciones. */
  @IsOptional()
  @IsIn(CANCELLATION_REASONS)
  reason?: CancellationReason

  /** `recent` (default): who entered the list last first. */
  @IsOptional()
  @IsIn(CAMPAIGN_SORTS)
  sort?: CampaignSort

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
