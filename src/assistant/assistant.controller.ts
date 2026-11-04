import { BadRequestException, Body, Controller, Post, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { AssistantService } from './assistant.service'
import { AskAssistantDto } from './dto/ask-assistant.dto'

/** The panel's AI assistant: questions about the portfolio, answered with the user's own data. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.OWNER)
@Controller('admin/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly scope: ScopeService,
  ) {}

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
}
