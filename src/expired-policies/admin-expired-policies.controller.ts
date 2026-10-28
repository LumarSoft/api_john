import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { HidePolicyDto } from './dto/hide-policy.dto'
import { ListExpiredPoliciesDto } from './dto/list-expired-policies.dto'
import { ExpiredPoliciesService } from './expired-policies.service'

@UseGuards(UserAuthGuard)
@Controller('admin/cobranzas/vencidas')
export class AdminExpiredPoliciesController {
  constructor(
    private readonly expiredPolicies: ExpiredPoliciesService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListExpiredPoliciesDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.expiredPolicies.list(req.user.producerId, codeIds, query)
  }

  @Patch(':id/hide')
  async hide(@Param('id', ParseIntPipe) id: number, @Body() body: HidePolicyDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.expiredPolicies.hide(id, req.user.producerId, codeIds, req.user.id, body.reason)
  }

  @Patch(':id/unhide')
  async unhide(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.expiredPolicies.unhide(id, req.user.producerId, codeIds)
  }
}
