import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { InboxService } from './inbox.service'
import { ListInboxDto } from './dto/list-inbox.dto'
import { SendInboxMessageDto } from './dto/send-inbox-message.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/inbox')
export class AdminInboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@Query() dto: ListInboxDto, @Request() req: AuthenticatedRequest) {
    return this.inbox.listConversations(req.user.producerId, dto)
  }

  @Get(':id/messages')
  getMessages(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.inbox.getMessages(id, req.user.producerId)
  }

  @Post(':id/takeover')
  takeover(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.inbox.takeover(id, req.user.producerId, req.user.id)
  }

  @Post(':id/release')
  release(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.inbox.release(id, req.user.producerId)
  }

  @Post(':id/message')
  sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendInboxMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.inbox.sendMessage(id, req.user.producerId, req.user.id, dto.text)
  }
}
