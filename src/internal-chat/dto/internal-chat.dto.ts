import { Transform, Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export const MESSAGE_MAX_LENGTH = 4000
export const PAGE_DEFAULT = 50
export const PAGE_MAX = 200

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class ListInternalChatMessagesDto {
  /** Older page: the messages before this id. Without it, the latest ones. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_MAX)
  limit?: number
}

export class SendInternalChatMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string
}

export class OpenDirectChatDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId: number
}

export class MarkInternalChatReadDto {
  /** The latest message the reader has on screen. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  messageId: number
}
