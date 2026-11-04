import { Module } from '@nestjs/common'
import { InboxModule } from '../inbox/inbox.module'
import { NoticesModule } from '../notices/notices.module'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { AdminSalesCampaignsController } from './admin-sales-campaigns.controller'
import { CampaignFinderService } from './campaign-finder.service'
import { CampaignTemplatesService } from './campaign-templates.service'
import { SalesCampaignsService } from './sales-campaigns.service'

/** Nico's sales campaigns: who to offer something to, and the Meta templates that write to them. */
@Module({
  imports: [InboxModule, NoticesModule, PlanFeaturesModule],
  controllers: [AdminSalesCampaignsController],
  providers: [SalesCampaignsService, CampaignFinderService, CampaignTemplatesService],
})
export class SalesCampaignsModule {}
