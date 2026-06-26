import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { PhoneNumbersService } from './phone-numbers.service'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'

@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/phone-numbers')
export class AdminPhoneNumbersController {
  constructor(private readonly service: PhoneNumbersService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest) {
    return this.service.list(req.user.producerId)
  }

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreatePhoneNumberDto) {
    return this.service.create(req.user.producerId, dto)
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdatePhoneNumberDto,
  ) {
    return this.service.update(id, req.user.producerId, dto)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.service.remove(id, req.user.producerId)
  }
}
