import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { InternalChatService } from './internal-chat.service'
import {
  ListInternalChatMessagesDto,
  MarkInternalChatReadDto,
  OpenDirectChatDto,
  SendInternalChatMessageDto,
} from './dto/internal-chat.dto'

/** "Chat interno": the office's own chat in the panel, apart from WhatsApp. */
@UseGuards(UserAuthGuard)
@Controller('admin/internal-chat')
export class AdminInternalChatController {
  constructor(private readonly chat: InternalChatService) {}

  @Get('chats')
  list(@Request() req: AuthenticatedRequest) {
    return this.chat.listChats(req.user)
  }

  @Get('unread')
  unread(@Request() req: AuthenticatedRequest) {
    return this.chat.unread(req.user)
  }

  @Get('people')
  people(@Request() req: AuthenticatedRequest) {
    return this.chat.people(req.user)
  }

  @Post('direct')
  openDirect(@Body() dto: OpenDirectChatDto, @Request() req: AuthenticatedRequest) {
    return this.chat.openDirect(req.user, dto)
  }

  @Get('chats/:id/messages')
  messages(
    @Param('id', ParseIntPipe) id: number,
    @Query() dto: ListInternalChatMessagesDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.chat.messages(req.user, id, dto)
  }

  @Post('chats/:id/messages')
  send(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendInternalChatMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.chat.send(req.user, id, dto)
  }

  @Post('chats/:id/read')
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkInternalChatReadDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.chat.markRead(req.user, id, dto)
  }

  @Delete('messages/:id')
  removeMessage(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.chat.removeMessage(req.user, id)
  }
}
