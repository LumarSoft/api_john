import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { SettlementQueryDto, SettlementSeriesQueryDto } from './dto/settlement-query.dto'
import { SettlementService } from './settlement.service'

/** "Liquidación" (owner only): each month's billing split between Lumarsoft and its commercial partner. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/settlement')
export class OwnerSettlementController {
  constructor(private readonly settlement: SettlementService) {}

  @Get()
  month(@Query() query: SettlementQueryDto) {
    return this.settlement.month(query.period)
  }

  @Get('series')
  series(@Query() query: SettlementSeriesQueryDto) {
    return this.settlement.series(query.to, query.months)
  }
}
