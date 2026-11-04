import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CobranzasScopeDto } from '../../clients/dto/list-cobranzas.dto'

/** Who a campaign finds, in the code or number the user picked, one page at a time. */
export class ListCampaignCandidatesDto extends CobranzasScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

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
