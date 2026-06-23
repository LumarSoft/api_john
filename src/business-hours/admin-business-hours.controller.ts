import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { BusinessHoursService } from './business-hours.service'
import { CreateClosureDto } from './dto/create-closure.dto'
import { UpdateScheduleDto } from './dto/update-schedule.dto'

/**
 * Admin "Horarios" screen. Admin-only and always scoped to the caller's producer,
 * so each tenant edits only its own weekly hours and closures.
 */
@UseGuards(UserAuthGuard)
@Controller('admin/business-hours')
export class AdminBusinessHoursController {
  constructor(private readonly service: BusinessHoursService) {}

  @Get()
  get(@Request() req: AuthenticatedRequest) {
    return this.service.getConfig(req.user.producerId)
  }

  @Patch('schedule')
  updateSchedule(@Request() req: AuthenticatedRequest, @Body() dto: UpdateScheduleDto) {
    return this.service.updateSchedule(req.user.producerId, dto)
  }

  @Post('closures')
  addClosure(@Request() req: AuthenticatedRequest, @Body() dto: CreateClosureDto) {
    return this.service.addClosure(req.user.producerId, dto)
  }

  @Delete('closures/:id')
  removeClosure(@Request() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeClosure(req.user.producerId, id)
  }
}
