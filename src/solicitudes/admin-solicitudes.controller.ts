import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { SolicitudesService } from './solicitudes.service'
import { ListSolicitudesDto } from './dto/list-solicitudes.dto'
import { SolicitudParamsDto } from './dto/solicitud-params.dto'
import { UpdateSolicitudDto } from './dto/update-solicitud.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/solicitudes')
export class AdminSolicitudesController {
  constructor(private readonly solicitudesService: SolicitudesService) {}

  @Get()
  findAll(@Query() query: ListSolicitudesDto, @Request() req: AuthenticatedRequest) {
    return this.solicitudesService.listForAdmin(req.user.producerId, query)
  }

  @Get(':kind/:id')
  findOne(@Param() params: SolicitudParamsDto, @Request() req: AuthenticatedRequest) {
    return this.solicitudesService.getDetail(req.user.producerId, params.kind, params.id)
  }

  @Patch(':kind/:id')
  update(@Param() params: SolicitudParamsDto, @Body() dto: UpdateSolicitudDto, @Request() req: AuthenticatedRequest) {
    return this.solicitudesService.updateStatus(req.user.producerId, params.kind, params.id, dto)
  }
}
