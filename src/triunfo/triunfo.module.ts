import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { TriunfoService } from './triunfo.service'
import { TriunfoCredentialsService } from './triunfo-credentials.service'
import { TriunfoErrorsService } from './triunfo-errors.service'
import { OwnerTriunfoController } from './owner-triunfo.controller'
import { AdminTriunfoController } from './admin-triunfo.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { IntegrationStatusModule } from '../integration-status/integration-status.module'

@Module({
  imports: [HttpModule, ConfigModule, PrismaModule, IntegrationStatusModule],
  controllers: [OwnerTriunfoController, AdminTriunfoController],
  providers: [TriunfoService, TriunfoCredentialsService, TriunfoErrorsService],
  exports: [TriunfoService, TriunfoCredentialsService, TriunfoErrorsService],
})
export class TriunfoModule {}
