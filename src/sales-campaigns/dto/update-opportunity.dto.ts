import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator'
import { SalesOpportunityLostReason, SalesOpportunityStatus } from 'generated/prisma/client'

/**
 * What the office says about one opportunity: closed as won (with the premium
 * when it knows it) or lost (why), reopened, a note, or who follows it. Every
 * field is optional; what is left out stays.
 */
export class UpdateOpportunityDto {
  /** WON, LOST or CONTACTED (reopened). The system's own states (REPLIED, QUOTED) are not set by hand. */
  @IsOptional()
  @IsEnum([SalesOpportunityStatus.WON, SalesOpportunityStatus.LOST, SalesOpportunityStatus.CONTACTED])
  status?: 'WON' | 'LOST' | 'CONTACTED'

  @IsOptional()
  @IsEnum(SalesOpportunityLostReason)
  lostReason?: SalesOpportunityLostReason

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsNumber()
  @Min(0)
  wonPremium?: number | null

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  assignedToId?: number | null
}
