import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request as ExpressRequest, Response } from 'express'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { describeChanges } from '../activity-log/request-origin'
import { AssistantService } from './assistant.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantActionsService } from './assistant-actions.service'
import { AssistantEnabledGuard } from './assistant-enabled.guard'
import { AskAssistantDto } from './dto/ask-assistant.dto'
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto'

/** The panel's AI assistant: questions answered with the user's own data, and changes they confirm. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.OWNER)
@Controller('admin/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly conversations: AssistantConversationsService,
    private readonly actions: AssistantActionsService,
    private readonly scope: ScopeService,
  ) {}

  /** The one-shot endpoint of earlier panels: kept while they are replaced. */
  @Post('ask')
  async ask(@Body() dto: AskAssistantDto, @Request() req: AuthenticatedRequest) {
    const last = dto.messages[dto.messages.length - 1]
    if (last.role !== 'user' || last.content.length > 2000) {
      throw new BadRequestException(
        'La última parte de la conversación tiene que ser una pregunta de hasta 2000 caracteres.',
      )
    }
    return this.assistant.ask(req.user, await this.scope.resolveAccessibleProducerCodeIds(req.user), dto)
  }

  @Get('conversations')
  @UseGuards(AssistantEnabledGuard)
  list(@Request() req: AuthenticatedRequest) {
    return this.conversations.list(req.user)
  }

  @Get('conversations/:id')
  @UseGuards(AssistantEnabledGuard)
  get(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.conversations.get(req.user, id)
  }

  @Delete('conversations/:id')
  @UseGuards(AssistantEnabledGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.conversations.remove(req.user, id)
  }

  /**
   * A question, answered as a stream of server-sent events: `conversation`
   * (when it starts a new one), `step`, `delta`, `action`, then `done` with
   * the saved answer or `error`. Anything wrong before the answer starts
   * (plan, limit, a conversation that is not theirs) is a plain HTTP error.
   */
  @Post('messages')
  async send(
    @Body() dto: SendAssistantMessageDto,
    @Request() req: AuthenticatedRequest & ExpressRequest,
    @Res() res: Response,
  ): Promise<void> {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    const turn = await this.assistant.start(req.user, codeIds, dto)

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const aborted = new AbortController()
    res.on('close', () => aborted.abort())
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    if (turn.created) emit('conversation', turn.created)
    try {
      const message = await this.assistant.respond(
        turn,
        {
          step: event => emit('step', event),
          delta: text => emit('delta', { text }),
          action: view => emit('action', view),
        },
        aborted.signal,
      )
      emit('done', { conversationId: turn.conversationId, message })
    } catch (error) {
      if (!aborted.signal.aborted) {
        emit('error', {
          message:
            error instanceof HttpException
              ? error.message
              : 'El asistente no pudo responder. Probá de nuevo en un rato.',
        })
      }
    } finally {
      res.end()
    }
  }

  /** Runs a change the assistant proposed, with the confirming user's own permissions. */
  @Post('actions/:id/confirm')
  @UseGuards(AssistantEnabledGuard)
  async confirm(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const result = await this.actions.confirm(req.user, id)
    // The activity log names what the confirm changed, as it does for the panel's own forms.
    const { type, status, preview } = result.action
    describeChanges(
      req,
      `${type} #${id} ${status} · ${preview.target}: ${preview.changes.map(c => c.label).join(', ')}`,
    )
    return result
  }

  @Post('actions/:id/cancel')
  @UseGuards(AssistantEnabledGuard)
  cancel(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.actions.cancel(req.user, id)
  }
}
