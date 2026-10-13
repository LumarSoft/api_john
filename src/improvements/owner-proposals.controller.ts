import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ListOwnerProposalsDto } from './dto/list-improvements.dto'
import { UpdateProposalDto } from './dto/proposal.dto'
import { ProposalsService } from './proposals.service'

/** Lumar (OWNER) reads every organization's proposals, answers them and sets their status. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/improvement-proposals')
export class OwnerProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  list(@Query() query: ListOwnerProposalsDto) {
    return this.proposals.listAll(query)
  }

  @Get('new-count')
  newCount() {
    return this.proposals.countNew()
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProposalDto) {
    return this.proposals.update(id, dto)
  }
}
