import { Controller, Get } from '@nestjs/common'
import { BusinessHoursService } from './business-hours.service'

/**
 * Public, unauthenticated live hours for the default producer: the formatted
 * weekly schedule, whether it is open right now, today's closure (if any) and a
 * ready-to-send message. Consumed by the public web and the WhatsApp bot so the
 * bot answers hour questions deterministically — no LLM.
 */
@Controller('public')
export class PublicHoursController {
  constructor(private readonly service: BusinessHoursService) {}

  @Get('hours')
  getHours() {
    return this.service.getStatusForDefault()
  }
}
