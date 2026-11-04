import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { BalanceService, type BalanceResponse } from './balance.service'
import { GetBalanceDto } from './dto/get-balance.dto'

const DEFAULT_MONTHS = 12

/** "Balance mensual": the month-end numbers of the codes the user sees. */
@UseGuards(UserAuthGuard)
@Controller('admin/balance')
export class AdminBalanceController {
  constructor(
    private readonly balance: BalanceService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async get(@Request() req: AuthenticatedRequest, @Query() query: GetBalanceDto): Promise<BalanceResponse> {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.balance.getBalance(req.user.producerId, codeIds, query.months ?? DEFAULT_MONTHS)
  }
}
