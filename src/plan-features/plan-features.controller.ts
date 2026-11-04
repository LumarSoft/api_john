import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { PlanFeaturesService } from './plan-features.service'

/** The panel asks which functions the organization's plans include, to show or lock them. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.OWNER)
@Controller('admin/billing/features')
export class PlanFeaturesController {
  constructor(private readonly planFeatures: PlanFeaturesService) {}

  @Get()
  find(@Request() req: AuthenticatedRequest) {
    return this.planFeatures.forUser(req.user)
  }
}
