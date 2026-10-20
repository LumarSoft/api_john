import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule } from '@nestjs/config'
import { SancorService } from './sancor.service'

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [SancorService],
  exports: [SancorService],
})
export class SancorModule {}
