import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { NovedadesModule } from '../novedades/novedades.module'
import { BotController } from './bot.controller'
import { BotService } from './bot.service'
import { MessageRetentionService } from './message-retention.service'

@Module({
  imports: [TriunfoModule, NovedadesModule],
  controllers: [BotController],
  providers: [BotService, MessageRetentionService],
})
export class BotModule {}
