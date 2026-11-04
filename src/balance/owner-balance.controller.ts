import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { MonthlyBalanceSnapshotService, type PeriodSnapshot } from './monthly-balance-snapshot.service'
import { RunBalanceSnapshotDto } from './dto/run-balance-snapshot.dto'

/** The platform owner closes (or recloses) a month's balance by hand. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/balance')
export class OwnerBalanceController {
  constructor(private readonly snapshots: MonthlyBalanceSnapshotService) {}

  @Post('snapshots')
  run(@Body() dto: RunBalanceSnapshotDto): Promise<PeriodSnapshot> {
    return this.snapshots.runForOwner(dto)
  }
}
