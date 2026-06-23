import { BadRequestException, Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { ProductPlansService } from './product-plans.service'
import { FIXED_PRODUCT_TYPES, type FixedProductType } from '../solicitudes/solicitudes.types'

// Bot pricing, scoped to the conversation's producer (multi-tenant).
@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotPricingController {
  constructor(private readonly productPlansService: ProductPlansService) {}

  @Get('conversation/:conversationId/pricing/:productType')
  list(@Param('conversationId', ParseIntPipe) conversationId: number, @Param('productType') productType: string) {
    if (!FIXED_PRODUCT_TYPES.includes(productType as FixedProductType)) {
      throw new BadRequestException(`Invalid productType "${productType}"`)
    }
    return this.productPlansService.listForConversation(conversationId, productType as FixedProductType)
  }
}
