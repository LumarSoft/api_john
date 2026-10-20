import { Module } from '@nestjs/common'
import { DocumentosModule } from '../documentos/documentos.module'
import { NovedadesModule } from '../novedades/novedades.module'
import { UsageModule } from '../usage/usage.module'
import { WhatsappOnboardingModule } from '../whatsapp-onboarding/whatsapp-onboarding.module'
import { BotController } from './bot.controller'
import { BotService } from './bot.service'
import { MessageRetentionService } from './message-retention.service'
import { CoexistenceSyncService } from './coexistence-sync.service'

@Module({
  imports: [DocumentosModule, NovedadesModule, UsageModule, WhatsappOnboardingModule],
  controllers: [BotController],
  providers: [BotService, MessageRetentionService, CoexistenceSyncService],
})
export class BotModule {}
