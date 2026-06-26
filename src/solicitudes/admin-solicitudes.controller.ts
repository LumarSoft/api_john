import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { SolicitudesService } from './solicitudes.service'
import { ListSolicitudesDto } from './dto/list-solicitudes.dto'
import { SolicitudParamsDto } from './dto/solicitud-params.dto'
import { UpdateSolicitudDto } from './dto/update-solicitud.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/solicitudes')
export class AdminSolicitudesController {
  constructor(
    private readonly solicitudesService: SolicitudesService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListSolicitudesDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIds(req.user, query.producerCodeId)
    return this.solicitudesService.listForAdmin(req.user.producerId, codeIds, query)
  }

  @Get(':kind/:id')
  async findOne(@Param() params: SolicitudParamsDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.solicitudesService.getDetail(req.user.producerId, codeIds, params.kind, params.id)
  }

  @Patch(':kind/:id')
  async update(
    @Param() params: SolicitudParamsDto,
    @Body() dto: UpdateSolicitudDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.solicitudesService.updateStatus(req.user.producerId, codeIds, params.kind, params.id, dto)
  }
}
