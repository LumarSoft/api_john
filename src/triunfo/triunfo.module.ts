import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { TriunfoService } from './triunfo.service'
import { TriunfoCredentialsService } from './triunfo-credentials.service'
import { OwnerTriunfoController } from './owner-triunfo.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [HttpModule, ConfigModule, PrismaModule],
  controllers: [OwnerTriunfoController],
  providers: [TriunfoService, TriunfoCredentialsService],
  exports: [TriunfoService],
})
export class TriunfoModule {}
