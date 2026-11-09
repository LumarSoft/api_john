import { Controller, Get, Header } from '@nestjs/common'
import { BillingService } from './billing.service'

/** The plans the landing shows: the same the owner configures. No auth. */
@Controller('public')
export class PublicPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @Header('Cache-Control', 'public, max-age=300')
  plans() {
    return this.billing.publicPlans()
  }
}
