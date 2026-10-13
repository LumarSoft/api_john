import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator'
import { TaskStatus } from 'generated/prisma/client'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export const TASK_VIEWS = ['mine', 'created', 'all'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export class ListTasksDto {
  /** mine = assigned to me, created = I assigned them, all = the whole office (SuperAdmin). */
  @IsOptional()
  @IsIn(TASK_VIEWS)
  view?: TaskView

  /** open = pending or in progress (default), done = finished. */
  @IsOptional()
  @IsIn(['open', 'done'])
  status?: 'open' | 'done'
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string

  @Type(() => Number)
  @IsInt()
  assignedToUserId: number

  /** Day it should be done by, YYYY-MM-DD. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string | null

  /** Who to call back, for a task that comes from a phone call. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assignedToUserId?: number

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string
}

export class CreateTaskCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string
}
