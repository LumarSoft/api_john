import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { IntegrationStatusService } from './integration-status.service'

/** The panel's Status section, for the SuperAdmin (and the OWNER): how Triunfo, InfoAuto and the WhatsApp numbers are answering. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/status')
export class AdminStatusController {
  constructor(private readonly status: IntegrationStatusService) {}

  @Get()
  overview(@Request() req: AuthenticatedRequest) {
    return this.status.overview(req.user)
  }
}
