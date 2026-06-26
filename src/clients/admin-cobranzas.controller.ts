import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ClientsService } from './clients.service'
import { ListCobranzasDto } from './dto/list-cobranzas.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/cobranzas')
export class AdminCobranzasController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListCobranzasDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIds(req.user, query.producerCodeId)
    return this.clientsService.findCobranzasForAdmin(req.user.producerId, codeIds, query)
  }

  @Get('stats')
  async getStats(@Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.clientsService.getCobranzasStats(req.user.producerId, codeIds)
  }
}
