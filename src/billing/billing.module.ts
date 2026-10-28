import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { AdminBillingController } from './admin-billing.controller'
import { BillingService } from './billing.service'

@Module({
  imports: [UsageModule],
  controllers: [AdminBillingController],
  providers: [BillingService],
})
export class BillingModule {}
