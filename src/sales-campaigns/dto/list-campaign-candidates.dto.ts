import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { SalesOpportunityStatus } from 'generated/prisma/client'
import { CobranzasScopeDto } from '../../clients/dto/list-cobranzas.dto'
import { CANCELLATION_REASONS, type CancellationReason } from '../campaign-catalog'

/** Where the opportunity stands, or `none`: nobody contacted or assigned yet. */
export const OPPORTUNITY_FILTERS = ['none', ...Object.values(SalesOpportunityStatus)] as const
export type OpportunityFilter = (typeof OPPORTUNITY_FILTERS)[number]

/**
 * The column the list is sorted by: the campaign's date (Motivo), the client,
 * the vehicle or the last message. `recent` and `oldest` are the date, newest
 * or oldest first: what the panels sent before the headers could sort.
 */
export const CAMPAIGN_SORTS = ['date', 'name', 'item', 'lastMessage', 'recent', 'oldest'] as const
export type CampaignSort = (typeof CAMPAIGN_SORTS)[number]
export type CampaignSortField = Exclude<CampaignSort, 'recent' | 'oldest'>

export const SORT_ORDERS = ['asc', 'desc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

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

  /** Where the opportunity stands (CONTACTED, WON…), or `none` for those nobody touched. */
  @IsOptional()
  @IsIn(OPPORTUNITY_FILTERS)
  status?: OpportunityFilter

  /** Only the opportunities this person follows. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedToId?: number

  /** `true`: only the opportunities the user follows (the controller resolves who). */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false'

  /** Default: `date`, newest first (in Renovaciones, the one that ends soonest). */
  @IsOptional()
  @IsIn(CAMPAIGN_SORTS)
  sort?: CampaignSort

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder

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
