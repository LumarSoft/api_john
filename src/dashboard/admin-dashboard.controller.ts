import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { DashboardService } from './dashboard.service'

@UseGuards(UserAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async getDashboard(@Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.dashboardService.getDashboard(req.user.producerId, codeIds)
  }
}
