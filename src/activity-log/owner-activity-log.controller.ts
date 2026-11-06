import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import type { Page } from '../common/pagination'
import { ActivityLogService, type ActivityLogEntry } from './activity-log.service'
import { ListActivityLogDto } from './dto/list-activity-log.dto'

/** The platform owner reads who changed what in the panels and from where. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/activity')
export class OwnerActivityLogController {
  constructor(private readonly activity: ActivityLogService) {}

  @Get()
  list(@Query() query: ListActivityLogDto): Promise<Page<ActivityLogEntry>> {
    return this.activity.list(query)
  }
}
