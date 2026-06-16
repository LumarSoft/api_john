import { Module } from '@nestjs/common'
import { SiniestrosController } from './siniestros.controller'
import { AdminSiniestrosController } from './admin-siniestros.controller'
import { SiniestrosService } from './siniestros.service'

@Module({
  controllers: [SiniestrosController, AdminSiniestrosController],
  providers: [SiniestrosService],
})
export class SiniestrosModule {}
