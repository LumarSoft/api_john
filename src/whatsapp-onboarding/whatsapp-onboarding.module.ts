import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { TemplateSyncModule } from '../template-sync/template-sync.module'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'
import { WhatsappOnboardingController } from './whatsapp-onboarding.controller'
import { WhatsappConnectionMonitorService } from './whatsapp-connection-monitor.service'
import { WhatsappPortfolioService } from './whatsapp-portfolio.service'

@Module({
  imports: [HttpModule, TemplateSyncModule],
  providers: [WhatsappOnboardingService, WhatsappConnectionMonitorService, WhatsappPortfolioService],
  controllers: [WhatsappOnboardingController],
  exports: [WhatsappOnboardingService, WhatsappConnectionMonitorService, WhatsappPortfolioService],
})
export class WhatsappOnboardingModule {}
