import { Module } from '@nestjs/common'
import { SiniestrosController } from './siniestros.controller'
import { SiniestrosService } from './siniestros.service'

@Module({
  controllers: [SiniestrosController],
  providers: [SiniestrosService],
})
export class SiniestrosModule {}
