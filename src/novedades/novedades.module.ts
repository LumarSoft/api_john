import { Module } from '@nestjs/common'
import { AdminNovedadesController } from './admin-novedades.controller'
import { NovedadesService } from './novedades.service'

@Module({
  controllers: [AdminNovedadesController],
  providers: [NovedadesService],
  // Exported so BotModule and SiniestrosModule can emit novedades.
  exports: [NovedadesService],
})
export class NovedadesModule {}
