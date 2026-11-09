import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsersService } from './users.service'
import { UpdateConfigDto } from './dto/update-config.dto'
import { UpdateBotProfileDto } from './dto/update-bot-profile.dto'

/**
 * Producer-level configuration for the admin "Configuración" screen, always
 * scoped to the caller's producer. Everyone reads it, and every admin of the
 * organization may change it (60ee071), though it applies to all its numbers.
 * A branch's own number is configured in admin/phone-numbers/:id/assistant.
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
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  update(@Request() req: AuthenticatedRequest, @Body() dto: UpdateConfigDto) {
    return this.usersService.updateProducerConfig(req.user.producerId, dto)
  }

  /** How the bot names the organization and its grúa, claims and payment data. */
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.getBotProfile(req.user.producerId)
  }

  /** What the bot tells customers about payments and assistance: any admin of the organization changes it. */
  @Patch('profile')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  updateProfile(@Request() req: AuthenticatedRequest, @Body() dto: UpdateBotProfileDto) {
    return this.usersService.updateBotProfile(req.user.producerId, dto)
  }
}
