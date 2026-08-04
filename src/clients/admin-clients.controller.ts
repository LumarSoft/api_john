import { Controller, Get, Param, ParseIntPipe, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ClientsService } from './clients.service'
import { ListClientsDto } from './dto/list-clients.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/clients')
export class AdminClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListClientsDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.clientsService.findAllForAdmin(req.user.producerId, codeIds, query)
  }

  @Get('stats')
  async getStats(@Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.clientsService.getAdminStats(req.user.producerId, codeIds)
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.clientsService.findOneForAdmin(id, req.user.producerId, codeIds)
  }
}
