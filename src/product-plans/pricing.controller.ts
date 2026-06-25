import { Controller, Get, Param } from '@nestjs/common'
import { ProductPlansService } from './product-plans.service'
import { PricingParamsDto } from './dto/pricing-params.dto'

// Public pricing for the web cotizador (bolso, hogar). Default producer.
@Controller('pricing')
export class PricingController {
  constructor(private readonly productPlansService: ProductPlansService) {}

  @Get(':productType')
  list(@Param() params: PricingParamsDto) {
    return this.productPlansService.listPublic(params.productType)
  }
}
