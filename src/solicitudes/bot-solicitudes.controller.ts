import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { BotAuthGuard } from '../bot/bot-auth.guard'
import { MAX_FILES, leadMulterOptions } from '../siniestros/siniestro-upload.config'
import { SolicitudesService } from './solicitudes.service'
import { CreateBotLeadDto } from './dto/create-bot-lead.dto'

// Bot lead creation. Scoped to the conversation's producer (multi-tenant) and
// guarded by the shared bot secret, mirroring the other /bot/conversation routes.
@UseGuards(BotAuthGuard)
@Controller('bot')
export class BotSolicitudesController {
  constructor(private readonly solicitudesService: SolicitudesService) {}

  @Post('conversation/:conversationId/leads')
  create(@Param('conversationId', ParseIntPipe) conversationId: number, @Body() dto: CreateBotLeadDto) {
    return this.solicitudesService.createBotLead(conversationId, dto)
  }

  // Photos the customer sends to take out a quoted policy (DNI, tarjeta azul).
  @Post('conversation/:conversationId/leads/:leadId/adjuntos')
  @UseInterceptors(FilesInterceptor('adjuntos', MAX_FILES, leadMulterOptions))
  attachAdjuntos(
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Param('leadId', ParseIntPipe) leadId: number,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Query('tipo') tipo?: string,
  ) {
    return this.solicitudesService.attachBotLeadAdjuntos(conversationId, leadId, files ?? [], tipo)
  }
}
