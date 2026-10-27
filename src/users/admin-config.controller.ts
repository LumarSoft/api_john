import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsersService } from './users.service'
import { UpdateConfigDto } from './dto/update-config.dto'
import { SetBotStatusDto } from './dto/set-bot-status.dto'
import { UpdateBotProfileDto } from './dto/update-bot-profile.dto'

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

  /** How the bot names the organization and its grúa, claims and payment data. */
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.getBotProfile(req.user.producerId)
  }

  /** Only a SuperAdmin changes what the bot tells customers about payments and assistance. */
  @Patch('profile')
  @Roles(Role.SUPERADMIN)
  updateProfile(@Request() req: AuthenticatedRequest, @Body() dto: UpdateBotProfileDto) {
    return this.usersService.updateBotProfile(req.user.producerId, dto)
  }

  /** Emergency organization-wide switch. Only a SuperAdmin may stop every chat. */
  @Patch('bot-status')
  @Roles(Role.SUPERADMIN)
  setBotStatus(@Request() req: AuthenticatedRequest, @Body() dto: SetBotStatusDto) {
    return this.usersService.setBotEnabled(req.user.producerId, dto.botEnabled, {
      id: req.user.id,
      email: req.user.email,
    })
  }
}
