import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UserIdParamDto } from './dto/user-id-param.dto'

@UseGuards(UserAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Self-service (any authenticated user) ──────────────
  @Get('me')
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.id)
  }

  @Patch('me')
  updateProfile(@Request() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto)
  }

  // ── Org user management (SuperAdmin only) ──────────────
  @Get()
  @Roles(Role.SUPERADMIN)
  findAll(@Request() req: AuthenticatedRequest) {
    return this.usersService.findAll(req.user.producerId)
  }

  /** Codes of the organization, to populate the assignment UI. */
  @Get('producer-codes')
  @Roles(Role.SUPERADMIN)
  listProducerCodes(@Request() req: AuthenticatedRequest) {
    return this.usersService.listProducerCodes(req.user.producerId)
  }

  @Post()
  @Roles(Role.SUPERADMIN)
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateUserDto) {
    return this.usersService.create(dto, req.user.producerId)
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN)
  update(@Request() req: AuthenticatedRequest, @Param() params: UserIdParamDto, @Body() dto: UpdateUserDto) {
    return this.usersService.update(params.id, req.user.producerId, dto)
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN)
  remove(@Request() req: AuthenticatedRequest, @Param() params: UserIdParamDto) {
    return this.usersService.remove(params.id, req.user.producerId, req.user.id)
  }
}
