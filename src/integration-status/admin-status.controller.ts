import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { IntegrationStatusService } from './integration-status.service'

/** The panel's Status section, for every panel user: how Triunfo, InfoAuto and the WhatsApp numbers are answering. */
@UseGuards(UserAuthGuard)
@Controller('admin/status')
export class AdminStatusController {
  constructor(private readonly status: IntegrationStatusService) {}

  @Get()
  overview(@Request() req: AuthenticatedRequest) {
    return this.status.overview(req.user)
  }
}
