import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsersService } from './users.service'
import { UpdateConfigDto } from './dto/update-config.dto'
import { SetBotStatusDto } from './dto/set-bot-status.dto'

/**
 * Producer-level configuration for the admin "Configuración" screen.
 * Admin-only (UserAuthGuard) and always scoped to the caller's producer, so each
 * branch/tenant edits only its own bot settings.
 */
@UseGuards(UserAuthGuard, RolesGuard)
@Controller('admin/config')
export class AdminConfigController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  get(@Request() req: AuthenticatedRequest) {
    return this.usersService.getProducerConfig(req.user.producerId)
  }

  @Patch()
  update(@Request() req: AuthenticatedRequest, @Body() dto: UpdateConfigDto) {
    return this.usersService.updateProducerConfig(req.user.producerId, dto)
  }

  /** Emergency organization-wide switch. Only a SuperAdmin may stop every chat. */
  @Patch('bot-status')
  @Roles(Role.SUPERADMIN)
  setBotStatus(@Request() req: AuthenticatedRequest, @Body() dto: SetBotStatusDto) {
    return this.usersService.setBotEnabled(req.user.producerId, dto.botEnabled)
  }
}
