import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * An `account_update` webhook the bot forwards because it may mean the number
 * left Cloud API (PARTNER_REMOVED, ACCOUNT_OFFBOARDED, PARTNER_APP_UNINSTALLED).
 * Every field is optional: older bot builds only sent `reason`.
 */
export class WabaAccountUpdateDto {
  // Meta's event name, e.g. PARTNER_REMOVED.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  event?: string

  // disconnection_info.reason, e.g. BUSINESS_DOWNGRADE or PRIMARY_INACTIVITY.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reason?: string

  // disconnection_info.initiated_by: USER or SYSTEM.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  initiatedBy?: string
}
