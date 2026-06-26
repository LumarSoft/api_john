import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { InboxService } from './inbox.service'
import { ListInboxDto } from './dto/list-inbox.dto'
import { SendInboxMessageDto } from './dto/send-inbox-message.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/inbox')
export class AdminInboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async list(@Query() dto: ListInboxDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIds(req.user, dto.producerCodeId)
    return this.inbox.listConversations(req.user.producerId, codeIds, dto)
  }

  @Get(':id/messages')
  async getMessages(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.inbox.getMessages(id, req.user.producerId, codeIds)
  }

  @Post(':id/takeover')
  async takeover(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.inbox.takeover(id, req.user.producerId, codeIds, req.user.id)
  }

  @Post(':id/release')
  async release(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.inbox.release(id, req.user.producerId, codeIds)
  }

  @Post(':id/message')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendInboxMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.inbox.sendMessage(id, req.user.producerId, codeIds, req.user.id, dto.text)
  }
}
