import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsageService } from './usage.service'

// The report carries provider cost, plan prices and margin: owner only.
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('admin/usage')
export class AdminUsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly scope: ScopeService,
  ) {}

  /** Monthly cost summary scoped to the codes the user can access.
   *  `?period=YYYY-MM` (defaults to current month), `?producerCodeId=` to filter. */
  @Get()
  async summary(
    @Request() req: AuthenticatedRequest,
    @Query('period') period?: string,
    @Query('producerCodeId') producerCodeId?: string,
  ) {
    const codeIds = await this.scope.resolveScopedCodeIds(req.user, producerCodeId ? Number(producerCodeId) : undefined)
    return this.usage.getSummary(req.user.producerId, codeIds, period || undefined)
  }
}
