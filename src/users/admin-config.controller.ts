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
 * scoped to the caller's producer. Everyone reads it; only the SuperAdmin
 * changes it, since it applies to every number without its own. A branch's
 * admin configures their own number in admin/phone-numbers/:id/assistant:
 * twice (6/11 and 10/11) a branch admin saved their branch's name, people and
 * bank account here and every other branch started using them.
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
  @Roles(Role.SUPERADMIN)
  update(@Request() req: AuthenticatedRequest, @Body() dto: UpdateConfigDto) {
    return this.usersService.updateProducerConfig(req.user.producerId, dto)
  }

  /** How the bot names the organization and its grúa, claims and payment data. */
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.getBotProfile(req.user.producerId)
  }

  /** What the bot tells customers about payments and assistance: only the SuperAdmin changes the organization's. */
  @Patch('profile')
  @Roles(Role.SUPERADMIN)
  updateProfile(@Request() req: AuthenticatedRequest, @Body() dto: UpdateBotProfileDto) {
    return this.usersService.updateBotProfile(req.user.producerId, dto)
  }
}
