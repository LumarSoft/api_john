import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class ListInboxDto {
  @IsOptional()
  @IsIn(['open', 'pending', 'closed'])
  status?: string

  // Matches client first/last name, DNI, or the WhatsApp number (waId).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string
}
