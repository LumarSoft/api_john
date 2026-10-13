import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { PageQueryDto } from './dto/list-improvements.dto'
import { CreateProposalDto } from './dto/proposal.dto'
import { ProposalsService } from './proposals.service'

/** The organization's shared board of improvement proposals. */
@UseGuards(UserAuthGuard)
@Controller('admin/improvement-proposals')
export class AdminProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest, @Query() query: PageQueryDto) {
    return this.proposals.listForOrganization(req.user.producerId, req.user.id, query)
  }

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateProposalDto) {
    return this.proposals.create(req.user.producerId, req.user.id, dto)
  }
}
