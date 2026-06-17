import { IsIn, IsOptional } from 'class-validator'

export class ListInboxDto {
  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string
}
