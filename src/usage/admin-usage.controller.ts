import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UsageService } from './usage.service'

@UseGuards(UserAuthGuard)
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
