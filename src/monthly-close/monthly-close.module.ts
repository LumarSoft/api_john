import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { MonthlyCloseService } from './monthly-close.service'
import { OwnerMonthlyCloseController } from './owner-monthly-close.controller'

@Module({
  imports: [UsageModule],
  controllers: [OwnerMonthlyCloseController],
  providers: [MonthlyCloseService],
  exports: [MonthlyCloseService],
})
export class MonthlyCloseModule {}
