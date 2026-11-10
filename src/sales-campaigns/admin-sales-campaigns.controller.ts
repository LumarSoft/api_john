import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { AssignOpportunitiesDto } from './dto/assign-opportunities.dto'
import { CampaignIdsDto } from './dto/campaign-ids.dto'
import { CampaignKindParamDto } from './dto/campaign-kind-param.dto'
import { CampaignResultsDto } from './dto/campaign-results.dto'
import { ListCampaignCandidatesDto } from './dto/list-campaign-candidates.dto'
import { OpportunityTargetParamDto } from './dto/opportunity-target-param.dto'
import { UpdateOpportunityDto } from './dto/update-opportunity.dto'
import { UpdateSalesCampaignDto } from './dto/update-sales-campaign.dto'
import { CampaignScope } from './campaign-finder.service'
import { SalesCampaignsService } from './sales-campaigns.service'

/** "Campañas" in the panel: each organization's sales campaigns and the clients they find. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.OWNER)
@Controller('admin/campaigns')
export class AdminSalesCampaignsController {
  constructor(
    private readonly campaigns: SalesCampaignsService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * The user's codes and, for what came through WhatsApp, their numbers: an
   * admin works their own branch only; the SuperAdmin everything, or the code
   * or number the section filter picked.
   */
  private async scopeOf(
    req: AuthenticatedRequest,
    filter?: { producerCodeId?: number; phoneNumberId?: number },
  ): Promise<CampaignScope> {
    const codeIds = filter
      ? await this.scope.resolveScopedCodeIdsFor(req.user, filter)
      : await this.scope.resolveAccessibleProducerCodeIds(req.user)
    const chats = await this.scope.resolveChatScope(req.user, codeIds, filter?.phoneNumberId)
    return { codeIds, chats }
  }

  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return this.campaigns.list(req.user, await this.scopeOf(req))
  }

  /** Before `:kind`: "results" is not a campaign. */
  @Get('results')
  async results(@Query() query: CampaignResultsDto, @Request() req: AuthenticatedRequest) {
    return this.campaigns.results(req.user, await this.scopeOf(req, query), query)
  }

  @Patch(':kind')
  async update(
    @Param() params: CampaignKindParamDto,
    @Body() dto: UpdateSalesCampaignDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.campaigns.update(req.user, params.kind, dto, await this.scopeOf(req))
  }

  @Post(':kind/templates/refresh')
  async refreshTemplates(@Param() params: CampaignKindParamDto, @Request() req: AuthenticatedRequest) {
    return this.campaigns.refreshTemplates(req.user, params.kind, await this.scopeOf(req))
  }

  @Get(':kind/candidates')
  async candidates(
    @Param() params: CampaignKindParamDto,
    @Query() query: ListCampaignCandidatesDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req, query)
    // "Mis oportunidades": the ones the user follows.
    const filters = query.mine === 'true' ? { ...query, assignedToId: req.user.id } : query
    return this.campaigns.candidates(req.user, params.kind, scope, filters)
  }

  @Post(':kind/assign')
  async assign(
    @Param() params: CampaignKindParamDto,
    @Body() body: AssignOpportunitiesDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req)
    return this.campaigns.assign(req.user, params.kind, scope, body)
  }

  @Patch(':kind/opportunities/:targetId')
  async updateOpportunity(
    @Param() params: OpportunityTargetParamDto,
    @Body() body: UpdateOpportunityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req)
    return this.campaigns.updateOpportunity(req.user, params.kind, scope, params.targetId, body)
  }

  @Post(':kind/send')
  async send(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req)
    return this.campaigns.send(req.user, params.kind, scope, body.ids)
  }

  @Post(':kind/mark')
  async mark(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req)
    return this.campaigns.mark(req.user, params.kind, scope, body.ids)
  }

  @Post(':kind/opt-out')
  async optOut(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const scope = await this.scopeOf(req)
    return this.campaigns.optOut(req.user, params.kind, scope, body.ids)
  }
}
