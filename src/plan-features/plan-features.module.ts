import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { PlanFeaturesController } from './plan-features.controller'
import { PlanFeaturesService } from './plan-features.service'

/** The panel functions each message plan includes; shared by every feature a plan can leave out. */
@Module({
  imports: [UsageModule],
  controllers: [PlanFeaturesController],
  providers: [PlanFeaturesService],
  exports: [PlanFeaturesService],
})
export class PlanFeaturesModule {}
