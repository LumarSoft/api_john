import { Module } from '@nestjs/common'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { AdminInternalChatController } from './admin-internal-chat.controller'
import { InternalChatService } from './internal-chat.service'

@Module({
  imports: [PlanFeaturesModule],
  controllers: [AdminInternalChatController],
  providers: [InternalChatService],
})
export class InternalChatModule {}
