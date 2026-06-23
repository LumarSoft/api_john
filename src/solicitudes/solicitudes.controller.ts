import { Body, Controller, Post } from '@nestjs/common'
import { SolicitudesService } from './solicitudes.service'
import { CreateLeadDto } from './dto/create-lead.dto'

// Public endpoint for the web cotizador (advisor-contact + fixed-plan products).
@Controller('leads')
export class SolicitudesController {
  constructor(private readonly solicitudesService: SolicitudesService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.solicitudesService.createWebLead(dto)
  }
}
