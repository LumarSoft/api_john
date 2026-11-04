import { Module } from '@nestjs/common'
import { MonthlyCloseModule } from '../monthly-close/monthly-close.module'
import { OwnerSettlementController } from './owner-settlement.controller'
import { SettlementService } from './settlement.service'

@Module({
  imports: [MonthlyCloseModule],
  controllers: [OwnerSettlementController],
  providers: [SettlementService],
})
export class SettlementModule {}
