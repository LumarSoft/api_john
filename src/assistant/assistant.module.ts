import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { AssistantController } from './assistant.controller'
import { AssistantDataService } from './assistant-data.service'
import { AssistantService } from './assistant.service'

/** The panel's AI assistant (read-only questions about the portfolio). */
@Module({
  imports: [HttpModule, PlanFeaturesModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantDataService],
})
export class AssistantModule {}
