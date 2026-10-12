import { Module } from '@nestjs/common'
import { AdminImprovementsController } from './admin-improvements.controller'
import { OwnerImprovementsController } from './owner-improvements.controller'
import { ImprovementsService } from './improvements.service'

@Module({
  controllers: [AdminImprovementsController, OwnerImprovementsController],
  providers: [ImprovementsService],
})
export class ImprovementsModule {}
