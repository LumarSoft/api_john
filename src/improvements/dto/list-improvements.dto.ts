import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { ImprovementArea } from 'generated/prisma/client'

/**
 * Page of a "Mejoras" list. Without `page` the endpoints still answer the full
 * array they returned before paginating, so a panel that doesn't page yet keeps working.
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number
}

export class ListImprovementsDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ImprovementArea)
  area?: ImprovementArea
}

export const OWNER_IMPROVEMENT_FILTERS = ['all', 'drafts', 'published'] as const
export type OwnerImprovementFilter = (typeof OWNER_IMPROVEMENT_FILTERS)[number]

export class ListOwnerImprovementsDto extends PageQueryDto {
  @IsOptional()
  @IsIn(OWNER_IMPROVEMENT_FILTERS)
  filter?: OwnerImprovementFilter
}

export const OWNER_PROPOSAL_FILTERS = ['open', 'all'] as const
export type OwnerProposalFilter = (typeof OWNER_PROPOSAL_FILTERS)[number]

export class ListOwnerProposalsDto extends PageQueryDto {
  @IsOptional()
  @IsIn(OWNER_PROPOSAL_FILTERS)
  filter?: OwnerProposalFilter
}
