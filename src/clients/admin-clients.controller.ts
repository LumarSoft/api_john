import { Controller, Get, Param, ParseIntPipe, Query, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ClientsService } from './clients.service'
import { ListClientsDto } from './dto/list-clients.dto'

@UseGuards(JwtAuthGuard)
@Controller('admin/clients')
export class AdminClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  findAll(@Query() query: ListClientsDto, @Request() req: { user: { producerId: number } }) {
    return this.clientsService.findAllForAdmin(req.user.producerId, query)
  }

  @Get('stats')
  getStats(@Request() req: { user: { producerId: number } }) {
    return this.clientsService.getAdminStats(req.user.producerId)
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Request() req: { user: { producerId: number } }) {
    return this.clientsService.findOneForAdmin(id, req.user.producerId)
  }
}
