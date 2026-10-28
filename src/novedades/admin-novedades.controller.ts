import {
  Body,
  Controller,
  Delete,
  Post,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { NovedadesService } from './novedades.service'
import { ListNovedadesDto, MarkAllReadDto, UpdateMatterDto } from './dto/list-novedades.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/novedades')
export class AdminNovedadesController {
  constructor(
    private readonly novedadesService: NovedadesService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListNovedadesDto, @Request() req: AuthenticatedRequest) {
    // A "productor" filter narrows by code; a "número" filter by the number the matter came through.
    const chats = await this.scope.resolveChatScope(
      req.user,
      await this.scope.resolveScopedCodeIds(req.user, query.producerCodeId),
      query.phoneNumberId,
    )
    return this.novedadesService.listForAdmin(req.user.producerId, chats, query)
  }

  @Delete()
  async clearAll(@Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.novedadesService.clearAll(req.user.producerId, chats)
  }

  @Get('stats')
  async getStats(@Query() query: ListNovedadesDto, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(
      req.user,
      await this.scope.resolveScopedCodeIds(req.user, query.producerCodeId),
      query.phoneNumberId,
    )
    return this.novedadesService.getStats(req.user.producerId, chats)
  }

  @Post('visit')
  visit(@Request() req: AuthenticatedRequest) {
    return this.novedadesService.registerVisit(req.user.id)
  }

  @Patch(':id/matter')
  async updateMatter(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMatterDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.novedadesService.updateMatter(id, req.user.producerId, chats, dto)
  }

  @Patch('read-all')
  async markAllRead(@Query() query: MarkAllReadDto, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.novedadesService.markAllRead(req.user.producerId, chats, query.type)
  }

  @Patch(':id/read')
  async markRead(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const chats = await this.scope.resolveChatScope(req.user)
    return this.novedadesService.markRead(id, req.user.producerId, chats)
  }
}
