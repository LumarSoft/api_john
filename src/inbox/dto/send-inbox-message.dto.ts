import { IsString, MinLength } from 'class-validator'

export class SendInboxMessageDto {
  @IsString()
  @MinLength(1)
  text: string
}
