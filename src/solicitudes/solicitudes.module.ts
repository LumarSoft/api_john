import { NovedadesModule } from '../novedades/novedades.module'
import { Module } from '@nestjs/common'
import { SolicitudesService } from './solicitudes.service'
import { SolicitudesController } from './solicitudes.controller'
import { AdminSolicitudesController } from './admin-solicitudes.controller'
import { BotSolicitudesController } from './bot-solicitudes.controller'

@Module({
  imports: [NovedadesModule],
  controllers: [SolicitudesController, AdminSolicitudesController, BotSolicitudesController],
  providers: [SolicitudesService],
})
export class SolicitudesModule {}
