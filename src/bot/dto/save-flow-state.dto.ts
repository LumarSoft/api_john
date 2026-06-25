import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

/**
 * The bot's serialized deterministic flow state ({ step, data } as JSON), or
 * null to clear it. ValidateIf lets an explicit null through (whitelist would
 * otherwise reject it) while still type-checking a provided string.
 */
export class SaveFlowStateDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(20000)
  flowState: string | null
}
