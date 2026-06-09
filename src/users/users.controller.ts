import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UserIdParamDto } from './dto/user-id-param.dto'

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@Request() req) {
    return this.usersService.getProfile(req.user.id)
  }

  @Patch('me')
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto)
  }

  @Get()
  findAll(@Request() req) {
    return this.usersService.findAll(req.user.producerId)
  }

  @Post()
  create(@Request() req, @Body() dto: CreateUserDto) {
    return this.usersService.create(dto, req.user.producerId)
  }

  @Patch(':id')
  update(@Request() req, @Param() params: UserIdParamDto, @Body() dto: UpdateUserDto) {
    return this.usersService.update(params.id, req.user.producerId, dto)
  }

  @Delete(':id')
  remove(@Request() req, @Param() params: UserIdParamDto) {
    return this.usersService.remove(params.id, req.user.producerId, req.user.id)
  }
}
