import { Module } from '@nestjs/common'
import { AdminImprovementsController } from './admin-improvements.controller'
import { OwnerImprovementsController } from './owner-improvements.controller'
import { AdminProposalsController } from './admin-proposals.controller'
import { OwnerProposalsController } from './owner-proposals.controller'
import { ImprovementsService } from './improvements.service'
import { ProposalsService } from './proposals.service'

@Module({
  controllers: [
    AdminImprovementsController,
    OwnerImprovementsController,
    AdminProposalsController,
    OwnerProposalsController,
  ],
  providers: [ImprovementsService, ProposalsService],
  // The AI assistant sends a proposal the office drafted with it.
  exports: [ProposalsService],
})
export class ImprovementsModule {}
