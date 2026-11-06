import { Module } from '@nestjs/common'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { NoticeDeliveryService } from './notice-delivery.service'
import { OwnerTemplatesController } from './owner-templates.controller'
import { TemplatesOverviewService } from './templates-overview.service'
import { WabaTemplatesService } from './waba-templates.service'

/** Shared by every feature that writes first to a client with a Meta template, and the owner's view of them. */
@Module({
  imports: [PlanFeaturesModule],
  controllers: [OwnerTemplatesController],
  providers: [NoticeDeliveryService, WabaTemplatesService, TemplatesOverviewService],
  exports: [NoticeDeliveryService, WabaTemplatesService],
})
export class NoticesModule {}
