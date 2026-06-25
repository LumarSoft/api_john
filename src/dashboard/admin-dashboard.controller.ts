import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { DashboardService } from './dashboard.service'

@UseGuards(UserAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@Request() req: AuthenticatedRequest) {
    return this.dashboardService.getDashboard(req.user.producerId)
  }
}
