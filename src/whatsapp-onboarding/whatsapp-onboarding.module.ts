import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'
import { WhatsappOnboardingController } from './whatsapp-onboarding.controller'

@Module({
  imports: [HttpModule],
  providers: [WhatsappOnboardingService],
  controllers: [WhatsappOnboardingController],
  exports: [WhatsappOnboardingService],
})
export class WhatsappOnboardingModule {}
