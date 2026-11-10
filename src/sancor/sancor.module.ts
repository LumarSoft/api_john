import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { SancorService } from './sancor.service'
import { SancorBotQuotesService } from './sancor-bot-quotes.service'
import { BotSancorQuotesController } from './bot-sancor-quotes.controller'

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [BotSancorQuotesController],
  providers: [SancorService, SancorBotQuotesService],
  exports: [SancorService],
})
export class SancorModule {}
