import { Module } from '@nestjs/common'
import { TriunfoModule } from '../triunfo/triunfo.module'
import { AdminDocumentosController } from './admin-documentos.controller'
import { DocumentosController } from './documentos.controller'
import { DocumentosService } from './documentos.service'

@Module({
  imports: [TriunfoModule],
  controllers: [DocumentosController, AdminDocumentosController],
  providers: [DocumentosService],
  exports: [DocumentosService],
})
export class DocumentosModule {}
