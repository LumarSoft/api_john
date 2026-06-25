import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { CarteraSyncService } from './cartera-sync.service'

@Module({
  imports: [TriunfoModule],
  providers: [CarteraSyncService],
})
export class CarteraSyncModule {}
