import { Module } from '@nestjs/common'
import { ImprovementsModule } from '../improvements/improvements.module'
import { PlanFeaturesModule } from '../plan-features/plan-features.module'
import { UsersModule } from '../users/users.module'
import { PhoneNumbersModule } from '../phone-numbers/phone-numbers.module'
import { BusinessHoursModule } from '../business-hours/business-hours.module'
import { NovedadesModule } from '../novedades/novedades.module'
import { TasksModule } from '../tasks/tasks.module'
import { SiniestrosModule } from '../siniestros/siniestros.module'
import { SolicitudesModule } from '../solicitudes/solicitudes.module'
import { IntegrationStatusModule } from '../integration-status/integration-status.module'
import { AssistantController } from './assistant.controller'
import { AssistantDataService } from './assistant-data.service'
import { AssistantService } from './assistant.service'
import { AssistantModelClient } from './assistant-model.client'
import { AssistantToolsService } from './assistant-tools.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantActionsService } from './assistant-actions.service'
import { AssistantRetentionService } from './assistant-retention.service'

/**
 * The panel's AI assistant: questions about the portfolio, the office's work
 * and the panel, and changes the person confirms, run through the same
 * services as the panel's own screens.
 */
@Module({
  imports: [
    PlanFeaturesModule,
    ImprovementsModule,
    UsersModule,
    PhoneNumbersModule,
    BusinessHoursModule,
    NovedadesModule,
    TasksModule,
    SiniestrosModule,
    SolicitudesModule,
    IntegrationStatusModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantDataService,
    AssistantModelClient,
    AssistantToolsService,
    AssistantContextService,
    AssistantConversationsService,
    AssistantActionsService,
    AssistantRetentionService,
  ],
})
export class AssistantModule {}
