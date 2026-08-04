import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { CarteraSyncService } from './cartera-sync.service'
import { AdminCarteraSyncController } from './admin-cartera-sync.controller'

@Module({
  imports: [TriunfoModule],
  providers: [CarteraSyncService],
  controllers: [AdminCarteraSyncController],
})
export class CarteraSyncModule {}
