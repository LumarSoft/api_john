import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { OwnerService } from './owner.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'
import { CreateProducerCodeDto } from './dto/create-producer-code.dto'
import { UpdateProducerCodeDto } from './dto/update-producer-code.dto'
import { CreateSuperAdminDto } from './dto/create-superadmin.dto'
import { CreateOrgUserDto, UpdateOrgUserDto } from './dto/manage-user.dto'

/**
 * Platform OWNER (Lumar) endpoints. The owner uses the same admin login as any
 * user; these routes are gated to role OWNER so only the platform operator can
 * provision and manage organizations (tenants), their codes and SuperAdmins.
 */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/organizations')
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get()
  list() {
    return this.owner.listOrganizations()
  }

  @Post()
  create(@Body() dto: CreateOrganizationDto) {
    return this.owner.createOrganization(dto)
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.owner.getOrganization(id)
  }

  @Patch(':id')
  setActive(@Param('id', ParseIntPipe) id: number, @Body('isActive') isActive: boolean) {
    return this.owner.setOrganizationActive(id, isActive)
  }

  @Post(':id/codes')
  addCode(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateProducerCodeDto) {
    return this.owner.addCode(id, dto)
  }

  @Patch(':id/codes/:codeId')
  updateCode(
    @Param('id', ParseIntPipe) id: number,
    @Param('codeId', ParseIntPipe) codeId: number,
    @Body() dto: UpdateProducerCodeDto,
  ) {
    return this.owner.updateCode(id, codeId, dto)
  }

  @Post(':id/superadmins')
  addSuperAdmin(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSuperAdminDto) {
    return this.owner.addSuperAdmin(id, dto)
  }

  // ── users of an organization ──────────────────────────
  // /users/* is scoped to the caller's own org; these let the OWNER manage any.

  @Post(':id/users')
  addUser(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateOrgUserDto) {
    return this.owner.addUser(id, dto)
  }

  @Patch(':id/users/:userId')
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateOrgUserDto,
  ) {
    return this.owner.updateUser(id, userId, dto)
  }

  @Delete(':id/users/:userId')
  removeUser(@Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.owner.removeUser(id, userId)
  }
}
