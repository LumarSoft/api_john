import { Module } from '@nestjs/common'
import { InboxModule } from '../inbox/inbox.module'
import { NoticesModule } from '../notices/notices.module'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { TasksModule } from '../tasks/tasks.module'
import { AdminSalesCampaignsController } from './admin-sales-campaigns.controller'
import { CampaignFinderService } from './campaign-finder.service'
import { CampaignTemplatesService } from './campaign-templates.service'
import { SalesCampaignsService } from './sales-campaigns.service'
import { SalesOpportunitiesService } from './sales-opportunities.service'

/** Nico's sales campaigns: who to offer something to, the Meta templates that write to them, and what came of each. */
@Module({
  imports: [InboxModule, NoticesModule, PlanFeaturesModule, TasksModule],
  controllers: [AdminSalesCampaignsController],
  providers: [SalesCampaignsService, SalesOpportunitiesService, CampaignFinderService, CampaignTemplatesService],
  exports: [SalesCampaignsService],
})
export class SalesCampaignsModule {}
