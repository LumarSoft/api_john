import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { CreateProposalDto } from './dto/proposal.dto'
import { ProposalsService } from './proposals.service'

/** The organization's shared board of improvement proposals. */
@UseGuards(UserAuthGuard)
@Controller('admin/improvement-proposals')
export class AdminProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest) {
    return this.proposals.listForOrganization(req.user.producerId, req.user.id)
  }

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateProposalDto) {
    return this.proposals.create(req.user.producerId, req.user.id, dto)
  }
}
