import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

export class UpdateInboxContactDto {
  // Name shown for whoever writes from this number. Empty or null goes back to
  // the automatic name (address book or WhatsApp profile).
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(191)
  contactName?: string | null

  // Removes the linked client, e.g. someone who asked with another person's DNI.
  @IsOptional()
  @IsBoolean()
  unlinkClient?: boolean
}
