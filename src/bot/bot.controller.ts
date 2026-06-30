import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { BotService } from './bot.service'
import { BotAuthGuard } from './bot-auth.guard'
import { SaveMessageDto } from './dto/save-message.dto'
import { SaveFlowStateDto } from './dto/save-flow-state.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'
import { MAX_FILES, siniestroMulterOptions } from '../siniestros/siniestro-upload.config'

@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Get('context/:phoneNumberId')
  getContext(@Param('phoneNumberId') phoneNumberId: string) {
    return this.botService.getContext(phoneNumberId)
  }

  @Post('conversation/:conversationId/message')
  saveMessage(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: SaveMessageDto) {
    return this.botService.saveMessage(conversationId, dto)
  }

  @Post('conversation/:conversationId/reset')
  resetSession(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.botService.resetSession(conversationId)
  }

  @Post('conversation/:conversationId/flow-state')
  saveFlowState(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: SaveFlowStateDto) {
    return this.botService.saveFlowState(conversationId, dto.flowState)
  }

  @Post('conversations/pending-warnings')
  claimPendingWarnings() {
    return this.botService.claimPendingWarnings()
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

  @Post('conversation/:conversationId/adjuntos')
  @UseInterceptors(FilesInterceptor('adjuntos', MAX_FILES, siniestroMulterOptions))
  attachAdjuntos(
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Query('tipo') tipo?: string,
  ) {
    return this.botService.attachAdjuntos(conversationId, files ?? [], tipo)
  }

  // Declared last on purpose: this two-segment GET (:phoneNumberId/:waId) is
  // greedy and would otherwise shadow the more specific GET routes above
  // (conversation/:id/polizas, /estado-cuenta, /siniestros), matching waId to
  // the literal suffix. Express resolves routes in registration order.
  @Get('conversation/:phoneNumberId/:waId')
  getOrCreateConversation(@Param('phoneNumberId') phoneNumberId: string, @Param('waId') waId: string) {
    return this.botService.getOrCreateConversation(phoneNumberId, waId)
  }

  @Post('conversation/:conversationId/request-handoff')
  requestHandoff(@Param('conversationId', ParseIntPipe) conversationId: number) {
    return this.botService.requestHandoff(conversationId)
  }
}
