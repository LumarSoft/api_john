import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { MonthlyCloseModule } from '../monthly-close/monthly-close.module'
import { AdminBillingController } from './admin-billing.controller'
import { OwnerBillingController } from './owner-billing.controller'
import { PublicPlansController } from './public-plans.controller'
import { BillingService } from './billing.service'

@Module({
  imports: [UsageModule, MonthlyCloseModule],
  controllers: [AdminBillingController, OwnerBillingController, PublicPlansController],
  providers: [BillingService],
})
export class BillingModule {}
