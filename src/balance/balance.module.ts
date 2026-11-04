import { Module } from '@nestjs/common'
import { AdminBalanceController } from './admin-balance.controller'
import { OwnerBalanceController } from './owner-balance.controller'
import { BalanceService } from './balance.service'
import { MonthlyBalanceSnapshotService } from './monthly-balance-snapshot.service'

@Module({
  controllers: [AdminBalanceController, OwnerBalanceController],
  providers: [BalanceService, MonthlyBalanceSnapshotService],
})
export class BalanceModule {}
