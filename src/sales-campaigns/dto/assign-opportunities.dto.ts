import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Min, ValidateIf } from 'class-validator'

/** "Asignar a…" over the ticked clients of a campaign: `assignedToId` null takes the assignee off. */
export class AssignOpportunitiesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[]

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  assignedToId: number | null
}
