import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { DocumentosController } from './documentos.controller'
import { DocumentosService } from './documentos.service'

@Module({
  imports: [TriunfoModule],
  controllers: [DocumentosController],
  providers: [DocumentosService],
})
export class DocumentosModule {}
