import { Module } from '@nestjs/common'
import { OwnerBalanceController } from './owner-balance.controller'
import { MonthlyBalanceSnapshotService } from './monthly-balance-snapshot.service'

@Module({
  controllers: [OwnerBalanceController],
  providers: [MonthlyBalanceSnapshotService],
})
export class BalanceModule {}
