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
  UseGuards,
} from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { PhoneNumbersService } from './phone-numbers.service'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'
import { UpdateNumberAssistantDto } from './dto/update-number-assistant.dto'

@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/phone-numbers')
export class AdminPhoneNumbersController {
  constructor(private readonly service: PhoneNumbersService) {}

  // Admins read the month's tokens of the numbers billed to their codes;
  // managing numbers stays with the SuperAdmin.
  @Get()
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  list(@Request() req: AuthenticatedRequest, @Query('period') period?: string) {
    return this.service.list(req.user.producerId, req.user.role, period, req.user.id)
  }

  // A number's own assistant (name, office people, hours and data): the service
  // lets an admin read and change only the numbers of their codes.
  @Get(':id/assistant')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  getAssistant(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.service.getAssistant(id, req.user)
  }

  @Patch(':id/assistant')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  updateAssistant(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateNumberAssistantDto,
  ) {
    return this.service.updateAssistant(id, req.user, dto)
  }

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreatePhoneNumberDto) {
    return this.service.create(req.user.producerId, dto, req.user.role)
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdatePhoneNumberDto,
  ) {
    return this.service.update(id, req.user.producerId, dto, req.user.role)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.service.remove(id, req.user.producerId)
  }
}
