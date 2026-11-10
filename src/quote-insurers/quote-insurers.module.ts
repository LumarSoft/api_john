import { Module } from '@nestjs/common'
import { SancorModule } from '../sancor/sancor.module'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { AdminQuoteInsurersController } from './admin-quote-insurers.controller'
import { QuoteInsurersService } from './quote-insurers.service'

@Module({
  imports: [TriunfoModule, SancorModule],
  controllers: [AdminQuoteInsurersController],
  providers: [QuoteInsurersService],
})
export class QuoteInsurersModule {}
