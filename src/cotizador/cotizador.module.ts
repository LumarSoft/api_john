import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { CotizadorService } from './cotizador.service'
import { CotizadorController } from './cotizador.controller'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [HttpModule, TriunfoModule, PrismaModule],
  controllers: [CotizadorController],
  providers: [CotizadorService],
})
export class CotizadorModule {}
