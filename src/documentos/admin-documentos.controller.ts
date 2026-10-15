import { Controller, Get, Param, ParseIntPipe, Request, StreamableFile, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { DocumentosService } from './documentos.service'

@UseGuards(UserAuthGuard)
@Controller('admin/clients')
export class AdminDocumentosController {
  constructor(
    private readonly documentosService: DocumentosService,
    private readonly scope: ScopeService,
  ) {}

  @Get(':id/polizas/:polizaId/documentos')
  async findByPoliza(
    @Param('id', ParseIntPipe) id: number,
    @Param('polizaId', ParseIntPipe) polizaId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.documentosService.listForPolicy(
      this.documentosService.adminPolicyWhere(id, polizaId, req.user.producerId, codeIds),
    )
  }

  @Get(':id/polizas/:polizaId/documentos/:code')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('polizaId', ParseIntPipe) polizaId: number,
    @Param('code', ParseIntPipe) code: number,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    const { filename, buffer } = await this.documentosService.downloadForPolicy(
      this.documentosService.adminPolicyWhere(id, polizaId, req.user.producerId, codeIds),
      String(code),
    )
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      length: buffer.length,
    })
  }
}
