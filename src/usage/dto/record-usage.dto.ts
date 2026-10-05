import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class RecordOpenAiUsageDto {
  @IsString()
  phoneNumberId: string // Meta phone_number_id

  @IsOptional()
  @IsString()
  @MaxLength(180)
  requestId?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  timestamp?: number

  @IsOptional()
  @IsString()
  @MaxLength(40)
  model?: string

  @IsInt()
  @Min(0)
  inputTokens: number

  @IsOptional()
  @IsInt()
  @Min(0)
  cachedInputTokens?: number

  @IsInt()
  @Min(0)
  outputTokens: number

  // Seconds of audio, for models billed per minute (transcription).
  @IsOptional()
  @IsInt()
  @Min(0)
  audioSeconds?: number
}

export class RecordMetaUsageDto {
  @IsString()
  phoneNumberId: string
  @IsString()
  @MaxLength(180)
  messageId: string
  @IsString()
  @MaxLength(40)
  category: string
  @IsBoolean()
  billable: boolean
  @IsString()
  recipient: string
  @IsInt()
  @Min(0)
  timestamp: number
}
