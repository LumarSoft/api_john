import { BadRequestException, Controller, Post, Body, Param, ParseIntPipe, Request, UseGuards } from '@nestjs/common'
import { CotizadorService } from './cotizador.service'
import { QuoteVehicleDto } from './dto/quote-vehicle.dto'
import { CoverageRequestDto } from './dto/coverage-request.dto'
import { VehicleTypeParamDto } from '../infoauto/dto/vehicle-type-param.dto'
import { VEHICLE_TYPE_PARAMS, vehicleTypeFromParam, type VehicleTypeParam } from '../infoauto/infoauto.types'
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard'

interface AuthenticatedRequest {
  user?: { id: number; producerId: number }
}

@Controller('cotizador')
export class CotizadorController {
  constructor(private readonly cotizadorService: CotizadorService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post(':vehicleType')
  quoteVehicle(
    @Param() params: VehicleTypeParamDto,
    @Body() dto: QuoteVehicleDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id ?? null
    const producerId = req.user?.producerId ?? null
    return this.cotizadorService.quoteVehicle(vehicleTypeFromParam(params.vehicleType), dto, producerId, userId)
  }

  // The lead is keyed by quoteNumber; vehicleType keeps the path parallel to the quote route
  @Post(':vehicleType/:quoteNumber/solicitud')
  requestCoverage(
    @Param('vehicleType') vehicleType: VehicleTypeParam,
    @Param('quoteNumber', ParseIntPipe) quoteNumber: number,
    @Body() dto: CoverageRequestDto,
  ) {
    if (!VEHICLE_TYPE_PARAMS.includes(vehicleType)) throw new BadRequestException('Invalid vehicle type')
    return this.cotizadorService.requestCoverage(quoteNumber, dto)
  }
}
