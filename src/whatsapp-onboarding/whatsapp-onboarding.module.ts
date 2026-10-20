import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'
import { WhatsappOnboardingController } from './whatsapp-onboarding.controller'
import { WhatsappConnectionMonitorService } from './whatsapp-connection-monitor.service'

@Module({
  imports: [HttpModule],
  providers: [WhatsappOnboardingService, WhatsappConnectionMonitorService],
  controllers: [WhatsappOnboardingController],
  exports: [WhatsappOnboardingService, WhatsappConnectionMonitorService],
})
export class WhatsappOnboardingModule {}
