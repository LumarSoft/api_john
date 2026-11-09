import { Controller, Get, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { TemplatesOverview, TemplatesOverviewService } from './templates-overview.service'

/** The owner's view of every organization's Meta templates (Plantillas). */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/templates')
export class OwnerTemplatesController {
  constructor(private readonly overview: TemplatesOverviewService) {}

  @Get()
  list(): Promise<TemplatesOverview> {
    return this.overview.overview()
  }
}
