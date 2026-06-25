import { Controller, Get, Param, ParseIntPipe, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { NovedadesService } from './novedades.service'
import { ListNovedadesDto, MarkAllReadDto } from './dto/list-novedades.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/novedades')
export class AdminNovedadesController {
  constructor(private readonly novedadesService: NovedadesService) {}

  @Get()
  findAll(@Query() query: ListNovedadesDto, @Request() req: AuthenticatedRequest) {
    return this.novedadesService.listForAdmin(req.user.producerId, query)
  }

  @Get('stats')
  getStats(@Request() req: AuthenticatedRequest) {
    return this.novedadesService.getStats(req.user.producerId)
  }

  @Patch('read-all')
  markAllRead(@Query() query: MarkAllReadDto, @Request() req: AuthenticatedRequest) {
    return this.novedadesService.markAllRead(req.user.producerId, query.type)
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.novedadesService.markRead(id, req.user.producerId)
  }
}
