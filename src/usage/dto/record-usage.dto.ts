import { IsInt, IsNumberString, IsOptional, IsString, Min } from 'class-validator'

export class RecordOpenAiUsageDto {
  @IsString()
  phoneNumberId: string // Meta phone_number_id

  @IsOptional()
  @IsString()
  model?: string

  @IsInt()
  @Min(0)
  inputTokens: number

  @IsInt()
  @Min(0)
  outputTokens: number
}

export class RecordMetaUsageDto {
  @IsString()
  phoneNumberId: string

  @IsOptional()
  @IsInt()
  @Min(0)
  conversations?: number

  // Decimal as string to avoid float drift (e.g. "0.0512").
  @IsOptional()
  @IsNumberString()
  costUsd?: string
}
