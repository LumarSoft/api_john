import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { TriunfoService } from './triunfo.service'

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [TriunfoService],
  exports: [TriunfoService],
})
export class TriunfoModule {}
