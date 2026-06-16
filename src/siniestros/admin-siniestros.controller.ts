import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { SiniestrosService } from './siniestros.service'
import { ListSiniestrosDto } from './dto/list-siniestros.dto'
import { UpdateSiniestroDto } from './dto/update-siniestro.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/siniestros')
export class AdminSiniestrosController {
  constructor(private readonly siniestrosService: SiniestrosService) {}

  @Get()
  findAll(@Query() query: ListSiniestrosDto, @Request() req: AuthenticatedRequest) {
    return this.siniestrosService.findAllForAdmin(req.user.producerId, query)
  }

  @Get('stats')
  getStats(@Request() req: AuthenticatedRequest) {
    return this.siniestrosService.getAdminStats(req.user.producerId)
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.siniestrosService.findOneForAdmin(id, req.user.producerId)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSiniestroDto, @Request() req: AuthenticatedRequest) {
    return this.siniestrosService.updateForAdmin(id, req.user.producerId, dto)
  }
}
