import { Module } from '@nestjs/common'
import { ProductPlansService } from './product-plans.service'
import { PricingController } from './pricing.controller'
import { AdminPricingController } from './admin-pricing.controller'
import { BotPricingController } from './bot-pricing.controller'

@Module({
  controllers: [PricingController, AdminPricingController, BotPricingController],
  providers: [ProductPlansService],
})
export class ProductPlansModule {}
