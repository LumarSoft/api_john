import { Module } from '@nestjs/common'
import { AdminBusinessHoursController } from './admin-business-hours.controller'
import { PublicHoursController } from './public-hours.controller'
import { BusinessHoursService } from './business-hours.service'

@Module({
  controllers: [AdminBusinessHoursController, PublicHoursController],
  providers: [BusinessHoursService],
})
export class BusinessHoursModule {}
