import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class ListInboxDto {
  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string

  // Matches client first/last name, DNI, or the WhatsApp number (waId).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  // SuperAdmin/admin "filter by código" selector (must be an accessible code).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerCodeId?: number
}
