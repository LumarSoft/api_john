import { Module } from '@nestjs/common'
import { NovedadesModule } from '../novedades/novedades.module'
import { SiniestrosController } from './siniestros.controller'
import { AdminSiniestrosController } from './admin-siniestros.controller'
import { SiniestrosService } from './siniestros.service'

@Module({
  imports: [NovedadesModule],
  controllers: [SiniestrosController, AdminSiniestrosController],
  providers: [SiniestrosService],
})
export class SiniestrosModule {}
