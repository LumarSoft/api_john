import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { SolicitudesService } from './solicitudes.service'
import { CreateLeadDto } from './dto/create-lead.dto'

// Bot lead creation. Scoped to the conversation's producer (multi-tenant) and
// guarded by the shared bot secret, mirroring the other /bot/conversation routes.
@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotSolicitudesController {
  constructor(private readonly solicitudesService: SolicitudesService) {}

  @Post('conversation/:conversationId/leads')
  create(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: CreateLeadDto) {
    return this.solicitudesService.createBotLead(conversationId, dto)
  }
}
