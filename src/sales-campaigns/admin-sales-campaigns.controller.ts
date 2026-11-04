import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { CampaignIdsDto } from './dto/campaign-ids.dto'
import { CampaignKindParamDto } from './dto/campaign-kind-param.dto'
import { ListCampaignCandidatesDto } from './dto/list-campaign-candidates.dto'
import { UpdateSalesCampaignDto } from './dto/update-sales-campaign.dto'
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

  @Get()
  async list(@Request() req: AuthenticatedRequest) {
    return this.campaigns.list(req.user, await this.scope.resolveAccessibleProducerCodeIds(req.user))
  }

  @Patch(':kind')
  async update(
    @Param() params: CampaignKindParamDto,
    @Body() dto: UpdateSalesCampaignDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.campaigns.update(
      req.user,
      params.kind,
      dto,
      await this.scope.resolveAccessibleProducerCodeIds(req.user),
    )
  }

  @Post(':kind/templates/refresh')
  async refreshTemplates(@Param() params: CampaignKindParamDto, @Request() req: AuthenticatedRequest) {
    return this.campaigns.refreshTemplates(
      req.user,
      params.kind,
      await this.scope.resolveAccessibleProducerCodeIds(req.user),
    )
  }

  @Get(':kind/candidates')
  async candidates(
    @Param() params: CampaignKindParamDto,
    @Query() query: ListCampaignCandidatesDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.campaigns.candidates(req.user, params.kind, codeIds, query)
  }

  @Post(':kind/send')
  async send(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.campaigns.send(req.user, params.kind, codeIds, body.ids)
  }

  @Post(':kind/mark')
  async mark(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.campaigns.mark(req.user, params.kind, codeIds, body.ids)
  }

  @Post(':kind/opt-out')
  async optOut(
    @Param() params: CampaignKindParamDto,
    @Body() body: CampaignIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.campaigns.optOut(req.user, params.kind, codeIds, body.ids)
  }
}
