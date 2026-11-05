import { Module } from '@nestjs/common'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { NoticeDeliveryService } from './notice-delivery.service'
import { WabaTemplatesService } from './waba-templates.service'

/** Shared by every feature that writes first to a client with a Meta template. */
@Module({
  imports: [PlanFeaturesModule],
  providers: [NoticeDeliveryService, WabaTemplatesService],
  exports: [NoticeDeliveryService],
})
export class NoticesModule {}
