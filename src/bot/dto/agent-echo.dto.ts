import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * A message an employee typed from the WhatsApp Business app on the phone.
 * Reaches us through Meta's `smb_message_echoes` webhook (Coexistence only).
 */
export class AgentEchoDto {
  // Meta phone_number_id the message went out through.
  @IsString()
  @MinLength(3)
  phoneNumberId: string

  // The customer on the other side — identifies the conversation.
  @IsString()
  @MinLength(3)
  waId: string

  // What the employee wrote. Non-text messages arrive as a short placeholder.
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content: string

  // Meta's message id, for tracing and de-duplication.
  @IsOptional()
  @IsString()
  waMessageId?: string
}
