import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { TriunfoService } from './triunfo.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [HttpModule, ConfigModule, PrismaModule],
  providers: [TriunfoService],
  exports: [TriunfoService],
})
export class TriunfoModule {}
