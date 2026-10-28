import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ClientsService } from './clients.service'
import { CobranzasScopeDto, ListCobranzasDto } from './dto/list-cobranzas.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/cobranzas')
export class AdminCobranzasController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListCobranzasDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.clientsService.findCobranzasForAdmin(req.user.producerId, codeIds, query)
  }

  // The same filters as the list, so the KPIs and the segment counts follow it.
  @Get('stats')
  async getStats(@Query() query: CobranzasScopeDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.clientsService.getCobranzasStats(req.user.producerId, codeIds, query.paymentMethod)
  }
}
