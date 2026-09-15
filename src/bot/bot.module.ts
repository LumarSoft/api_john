import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { NovedadesModule } from '../novedades/novedades.module'
import { UsageModule } from '../usage/usage.module'
import { BotController } from './bot.controller'
import { BotService } from './bot.service'
import { MessageRetentionService } from './message-retention.service'
import { CoexistenceSyncService } from './coexistence-sync.service'

@Module({
  imports: [TriunfoModule, NovedadesModule, UsageModule],
  controllers: [BotController],
  providers: [BotService, MessageRetentionService, CoexistenceSyncService],
})
export class BotModule {}
