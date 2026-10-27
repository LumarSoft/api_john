import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { BusinessHoursService } from './business-hours.service'

/**
 * Live hours for the bot, scoped to the organization of the number the chat
 * came through: GET /public/hours only knows the default organization.
 */
@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotHoursController {
  constructor(private readonly service: BusinessHoursService) {}

  @Get('numbers/:phoneNumberId/hours')
  getHours(@Param('phoneNumberId') phoneNumberId: string) {
    return this.service.getStatusForNumber(phoneNumberId)
  }
}
