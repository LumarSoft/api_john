import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { AdminStatusController } from './admin-status.controller'
import { IncidentExplainerService } from './incident-explainer.service'
import { IntegrationStatusService } from './integration-status.service'

@Module({
  imports: [HttpModule],
  controllers: [AdminStatusController],
  providers: [IntegrationStatusService, IncidentExplainerService],
  exports: [IntegrationStatusService],
})
export class IntegrationStatusModule {}
