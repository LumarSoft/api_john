import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { SancorBotQuoteDto } from './dto/sancor-bot-quote.dto'
import { SancorBotQuotesService } from './sancor-bot-quotes.service'

/** Sancor prices for the bot's lead products, scoped to the conversation's organization. */
@UseGuards(BotAuthGuard)
@Controller('bot/conversation/:conversationId/sancor')
export class BotSancorQuotesController {
  constructor(private readonly quotes: SancorBotQuotesService) {}

  @Get('products')
  products(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.quotes.productsFor(conversationId)
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: SancorBotQuoteDto) {
    return this.quotes.quote(conversationId, dto)
  }
}
