import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ImprovementsModule } from '../improvements/improvements.module'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { AssistantController } from './assistant.controller'
import { AssistantDataService } from './assistant-data.service'
import { AssistantService } from './assistant.service'

/** The panel's AI assistant: questions about the portfolio and the panel, and improvement proposals. */
@Module({
  imports: [HttpModule, PlanFeaturesModule, ImprovementsModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantDataService],
})
export class AssistantModule {}
