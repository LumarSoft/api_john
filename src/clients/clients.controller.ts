import { Controller, Get, Param, ParseIntPipe, Request, UseGuards } from '@nestjs/common'
import { ClientsService } from './clients.service'
import { ClientAuthGuard } from '../auth/client-auth.guard'

interface ClientRequest {
  user: { id: number; producerId: number; type: string }
}

@Controller('clients')
@UseGuards(ClientAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get('me/polizas')
  getMyPolizas(@Request() req: ClientRequest) {
    return this.clientsService.findPolizas(req.user.id, req.user.producerId)
  }

  @Get('me/polizas/:id')
  getPoliza(@Param('id', ParseIntPipe) id: number, @Request() req: ClientRequest) {
    return this.clientsService.findPolizaById(id, req.user.id, req.user.producerId)
  }
}
