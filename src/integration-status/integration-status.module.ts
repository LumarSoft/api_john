import { Module } from '@nestjs/common'
import { AdminStatusController } from './admin-status.controller'
import { IntegrationStatusService } from './integration-status.service'

@Module({
  controllers: [AdminStatusController],
  providers: [IntegrationStatusService],
  exports: [IntegrationStatusService],
})
export class IntegrationStatusModule {}
