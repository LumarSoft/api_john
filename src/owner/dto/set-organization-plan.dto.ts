import { IsInt, Min, ValidateIf } from 'class-validator'

/** The catalog plan the owner puts an organization on; null takes it off (back to the automatic one). */
export class SetOrganizationPlanDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  planId: number | null
}
