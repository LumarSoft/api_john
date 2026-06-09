import { Module } from '@nestjs/common'
import { ClientsController } from './clients.controller'
import { AdminClientsController } from './admin-clients.controller'
import { ClientsService } from './clients.service'

@Module({
  controllers: [ClientsController, AdminClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
