import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { InboxService } from './inbox.service'
import { ListInboxDto } from './dto/list-inbox.dto'
import { SendInboxMessageDto } from './dto/send-inbox-message.dto'
import { SendInboxMediaDto } from './dto/send-inbox-media.dto'
import { outgoingMediaMulterOptions } from '../siniestros/siniestro-upload.config'
import { UpdateInboxContactDto } from './dto/update-inbox-contact.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/inbox')
export class AdminInboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async list(@Query() dto: ListInboxDto, @Request() req: AuthenticatedRequest) {
    // An admin sees only the chats of their own numbers; the SuperAdmin may
    // narrow by code with the section filter.
    const chats = await this.scope.resolveChatScope(
      req.user,
      await this.scope.resolveScopedCodeIds(req.user, dto.producerCodeId),
    )
    // "Filter by número/sucursal": narrow to conversations that came through that
    // exact Meta number (independent of the code dimension above).
    const metaPhoneNumberId =
      dto.phoneNumberId != null ? await this.scope.metaPhoneNumberId(req.user.producerId, dto.phoneNumberId) : null
    return this.inbox.listConversations(req.user.producerId, chats, dto, metaPhoneNumberId)
  }

  @Delete()
  async deleteAll(@Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.deleteConversations(req.user.producerId, chats)
  }

  @Delete(':id')
  async deleteOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.deleteConversations(req.user.producerId, chats, id)
  }

  @Get(':id/messages')
  async getMessages(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.getMessages(id, req.user.producerId, chats)
  }

  @Patch(':id/contact')
  async updateContact(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInboxContactDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.updateContact(id, req.user.producerId, chats, dto)
  }

  @Post(':id/takeover')
  async takeover(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.takeover(id, req.user.producerId, chats, req.user.id)
  }

  @Post(':id/release')
  async release(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.release(id, req.user.producerId, chats)
  }

  @Post(':id/message')
  async sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendInboxMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.sendMessage(id, req.user.producerId, chats, req.user.id, dto.text)
  }

  @Post(':id/media')
  @UseInterceptors(FileInterceptor('file', outgoingMediaMulterOptions))
  async sendMedia(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SendInboxMediaDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.inbox.sendMedia(id, req.user.producerId, chats, file, dto.caption)
  }
}
