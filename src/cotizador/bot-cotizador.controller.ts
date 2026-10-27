import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { CotizadorService } from './cotizador.service'
import { QuoteVehicleDto } from './dto/quote-vehicle.dto'
import { BotQuoteParamsDto } from './dto/bot-quote-params.dto'
import { vehicleTypeFromParam } from '../infoauto/infoauto.types'

// Bot quotes, scoped to the organization of the number the chat came through.
@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotCotizadorController {
  constructor(private readonly cotizadorService: CotizadorService) {}

  @Post('numbers/:phoneNumberId/cotizador/:vehicleType')
  quoteVehicle(@Param() params: BotQuoteParamsDto, @Body() dto: QuoteVehicleDto) {
    return this.cotizadorService.quoteVehicleForNumber(
      params.phoneNumberId,
      vehicleTypeFromParam(params.vehicleType),
      dto,
    )
  }
}
