import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { BusinessHoursService } from './business-hours.service'
import { UpdateScheduleDto } from './dto/update-schedule.dto'

/**
 * Admin "Horarios" screen, always scoped to the caller's producer: the
 * organization's weekly hours, the ones every number without its own uses.
 * Holidays and closures are each number's (admin/phone-numbers/:id/closures):
 * a branch's closure never closes the others.
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
}
