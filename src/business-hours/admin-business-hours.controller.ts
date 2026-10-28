import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { BusinessHoursService } from './business-hours.service'
import { CreateClosureDto } from './dto/create-closure.dto'
import { UpdateScheduleDto } from './dto/update-schedule.dto'

/**
 * Admin "Horarios" screen, always scoped to the caller's producer, so each
 * tenant edits only its own weekly hours and closures. Everyone reads them; they
 * apply to the whole organization, so only the SuperAdmin changes them (a
 * branch's number can have its own hours, see admin/phone-numbers/:id/assistant).
 */
@UseGuards(UserAuthGuard, RolesGuard)
@Controller('admin/business-hours')
export class AdminBusinessHoursController {
  constructor(private readonly service: BusinessHoursService) {}

  @Get()
  get(@Request() req: AuthenticatedRequest) {
    return this.service.getConfig(req.user.producerId)
  }

  @Patch('schedule')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  updateSchedule(@Request() req: AuthenticatedRequest, @Body() dto: UpdateScheduleDto) {
    return this.service.updateSchedule(req.user.producerId, dto)
  }

  @Post('closures')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  addClosure(@Request() req: AuthenticatedRequest, @Body() dto: CreateClosureDto) {
    return this.service.addClosure(req.user.producerId, dto)
  }

  @Delete('closures/:id')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  removeClosure(@Request() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeClosure(req.user.producerId, id)
  }
}
