import { Controller, Get, Param, ParseIntPipe, Request, UseGuards } from '@nestjs/common'
import { ClientAuthGuard } from '../auth/client-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { DocumentosService } from './documentos.service'

@Controller('clients')
@UseGuards(ClientAuthGuard)
export class DocumentosController {
  constructor(private readonly documentosService: DocumentosService) {}

  @Get('me/polizas/:id/documentos')
  findByPoliza(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.documentosService.findByPoliza(id, req.user.id, req.user.producerId)
  }
}
