import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ClientsService } from './clients.service'
import { ListCobranzasDto } from './dto/list-cobranzas.dto'

@UseGuards(JwtAuthGuard)
@Controller('admin/cobranzas')
export class AdminCobranzasController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll(@Query() query: ListCobranzasDto, @Request() req: { user: { producerId: number } }) {
    return this.clientsService.findCobranzasForAdmin(req.user.producerId, query)
  }

  @Get('stats')
  getStats(@Request() req: { user: { producerId: number } }) {
    return this.clientsService.getCobranzasStats(req.user.producerId)
  }
}
