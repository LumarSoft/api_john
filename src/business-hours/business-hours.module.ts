import { Module } from '@nestjs/common'
import { AdminBusinessHoursController } from './admin-business-hours.controller'
import { PublicHoursController } from './public-hours.controller'
import { BusinessHoursService } from './business-hours.service'
import { HolidaySyncService } from './holiday-sync.service'

@Module({
  controllers: [AdminBusinessHoursController, PublicHoursController],
  providers: [BusinessHoursService, HolidaySyncService],
})
export class BusinessHoursModule {}
