import { Controller, Get, Param, ParseIntPipe, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { NovedadesService } from './novedades.service'
import { ListNovedadesDto, MarkAllReadDto } from './dto/list-novedades.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/novedades')
export class AdminNovedadesController {
  constructor(
    private readonly novedadesService: NovedadesService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListNovedadesDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.novedadesService.listForAdmin(req.user.producerId, codeIds, query)
  }

  @Get('stats')
  async getStats(@Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.novedadesService.getStats(req.user.producerId, codeIds)
  }

  @Patch('read-all')
  async markAllRead(@Query() query: MarkAllReadDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.novedadesService.markAllRead(req.user.producerId, codeIds, query.type)
  }

  @Patch(':id/read')
  async markRead(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.novedadesService.markRead(id, req.user.producerId, codeIds)
  }
}
