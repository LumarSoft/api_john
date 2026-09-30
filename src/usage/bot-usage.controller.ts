import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { UsageService } from './usage.service'
import { RecordMetaUsageDto, RecordOpenAiUsageDto } from './dto/record-usage.dto'

/** Bot-only cost reporting (x-bot-secret). The bot calls these after each LLM
 *  completion and when Meta reports a delivered message. */
@UseGuards(BotAuthGuard)
@Controller('bot/usage')
export class BotUsageController {
  constructor(private readonly usage: UsageService) {}

  @Post('openai')
  recordOpenAI(@Body() dto: RecordOpenAiUsageDto) {
    return this.usage.recordOpenAI({
      metaPhoneNumberId: dto.phoneNumberId,
      model: dto.model,
      requestId: dto.requestId,
      timestamp: dto.timestamp,
      inputTokens: dto.inputTokens,
      outputTokens: dto.outputTokens,
      cachedInputTokens: dto.cachedInputTokens,
    })
  }

  @Post('meta')
  recordMeta(@Body() dto: RecordMetaUsageDto) {
    return this.usage.recordMeta({
      metaPhoneNumberId: dto.phoneNumberId,
      messageId: dto.messageId,
      category: dto.category,
      billable: dto.billable,
      recipient: dto.recipient,
      timestamp: dto.timestamp,
    })
  }
}
