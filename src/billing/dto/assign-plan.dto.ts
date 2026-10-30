import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

/** The paid plan of the catalog a number goes on (SuperAdmin). */
export class AssignPlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId: number
}
