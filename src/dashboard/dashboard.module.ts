import { Module } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { AdminDashboardController } from './admin-dashboard.controller'

@Module({
  controllers: [AdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
