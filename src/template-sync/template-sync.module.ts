import { Module } from '@nestjs/common'
import { NoticesModule } from '../notices/notices.module'
import { SalesCampaignsModule } from '../sales-campaigns/sales-campaigns.module'
import { TemplateSyncService } from './template-sync.service'

/** Keeps every WhatsApp account with the Meta templates the platform sends: nobody creates them by hand. */
@Module({
  imports: [NoticesModule, SalesCampaignsModule],
  providers: [TemplateSyncService],
  exports: [TemplateSyncService],
})
export class TemplateSyncModule {}
