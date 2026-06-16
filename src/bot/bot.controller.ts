import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common'
import { BotService } from './bot.service'
import { BotAuthGuard } from './bot-auth.guard'
import { SaveMessageDto } from './dto/save-message.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'

@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Get('context/:phoneNumberId')
  getContext(@Param('phoneNumberId') phoneNumberId: string) {
    return this.botService.getContext(phoneNumberId)
  }

  @Get('conversation/:phoneNumberId/:waId')
  getOrCreateConversation(@Param('phoneNumberId') phoneNumberId: string, @Param('waId') waId: string) {
    return this.botService.getOrCreateConversation(phoneNumberId, waId)
  }

  @Post('conversation/:conversationId/message')
  saveMessage(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: SaveMessageDto) {
    return this.botService.saveMessage(conversationId, dto)
  }

  @Post('conversation/:conversationId/identify')
  identifyClient(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: IdentifyClientDto) {
    return this.botService.identifyClient(conversationId, dto)
  }

  @Get('conversation/:conversationId/polizas')
  getPolizas(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.botService.getPolizas(conversationId)
  }

  @Get('conversation/:conversationId/estado-cuenta')
  getEstadoCuenta(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.botService.getEstadoCuenta(conversationId)
  }

  @Get('conversation/:conversationId/polizas/:polizaId/documentos')
  getDocumentos(
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Param('polizaId', ParseIntPipe) polizaId: number,
  ) {
    return this.botService.getDocumentos(conversationId, polizaId)
  }

  @Get('conversation/:conversationId/siniestros')
  getSiniestros(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.botService.getSiniestros(conversationId)
  }

  @Post('conversation/:conversationId/siniestros')
  createSiniestro(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: CreateBotSiniestroDto) {
    return this.botService.createSiniestro(conversationId, dto)
  }
}
