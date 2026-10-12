import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ConversationStatus } from 'generated/prisma/client'

export class ListInboxDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus

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

  // SuperAdmin "filter by número/sucursal" — a PhoneNumber id. For the inbox this
  // filters conversations that came through that exact number.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  phoneNumberId?: number
}
