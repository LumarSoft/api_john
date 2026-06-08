import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common'
import { CotizadorService } from './cotizador.service'
import { CotizarAutoDto } from './dto/cotizar-auto.dto'
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard'

@Controller('cotizador')
export class CotizadorController {
  constructor(private readonly cotizadorService: CotizadorService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post('auto')
  cotizarAuto(@Body() dto: CotizarAutoDto, @Request() req) {
    const userId = req.user?.id ?? null
    const producerId = req.user?.producerId ?? null
    return this.cotizadorService.cotizarAuto(dto, producerId, userId)
  }
}
