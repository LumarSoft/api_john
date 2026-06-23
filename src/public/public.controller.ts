import { Controller, Get } from '@nestjs/common'
import { PublicService } from './public.service'

/**
 * Unauthenticated read-only data shared by the public web and the WhatsApp bot:
 * the product catalog (descriptions, no prices) and the producer's attention
 * window. Single source of truth so the site and the bot never contradict.
 */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('products')
  getProducts() {
    return this.publicService.getProducts()
  }

  @Get('producer')
  getProducerInfo() {
    return this.publicService.getProducerInfo()
  }
}
