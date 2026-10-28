import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { UpdateBotProfileDto } from '../../users/dto/update-bot-profile.dto'

/**
 * A number's own assistant. Only the fields sent change; clearing one (empty
 * string, empty list, null hours, empty profile field) makes the number use the
 * organization's value again.
 */
export class UpdateNumberAssistantDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  botName?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  staffNames?: string[]

  /** Weekly schedule { mon: [{from,to}], ..., sun: [] }, validated in the service; null = the organization's. */
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown> | null

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBotProfileDto)
  botProfile?: UpdateBotProfileDto

  /**
   * How this number offers the organization's coverages: { "<code>": { isActive, highlighted, sortOrder } },
   * only the fields it changes; checked in the service. null = as the organization.
   */
  @IsOptional()
  @IsObject()
  coverageSettings?: Record<string, unknown> | null
}
