import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator'

/** "Crear tarea" over the ticked clients of a campaign: one task each, for one person of the office. */
export class CreateCampaignTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[]

  @IsInt()
  @Min(1)
  assignedToId: number

  /** Day the tasks should be done by, YYYY-MM-DD. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string

  /** What to do, added to each task under the client's data. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}
