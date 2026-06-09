import { Controller, Get, Param, ParseIntPipe, Request, UseGuards } from '@nestjs/common'
import { ClientsService } from './clients.service'
import { ClientAuthGuard } from '../auth/client-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'

@Controller('clients')
@UseGuards(ClientAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get('me/polizas')
  getMyPolizas(@Request() req: AuthenticatedRequest) {
    return this.clientsService.findPolizas(req.user.id, req.user.producerId)
  }

  @Get('me/polizas/:id')
  getPoliza(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.clientsService.findPolizaById(id, req.user.id, req.user.producerId)
  }
}
