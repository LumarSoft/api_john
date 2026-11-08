import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'

/** The panel screen the person is on, so "esto" and "acá" mean something. */
export class PanelPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  // A path and nothing else: it goes into the assistant's instructions.
  @Matches(/^\/admin(\/[\w.~%-]+)*\/?$/, { message: 'route must be a panel path' })
  route?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[^\r\n\t]*$/, { message: 'screen must be one line' })
  screen?: string
}

/** A question to the assistant: in a conversation, or starting a new one. */
export class SendAssistantMessageDto {
  /** The conversation it continues; without it, a new one starts. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content: string

  @IsOptional()
  @ValidateNested()
  @Type(() => PanelPageDto)
  page?: PanelPageDto
}
