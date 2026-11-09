import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ClosePeriodDto } from './dto/close-period.dto'
import { MonthlyCloseService } from './monthly-close.service'

/** The owner closes a past month by hand: to backfill the months before the close existed, or to redo one. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/billing')
export class OwnerMonthlyCloseController {
  constructor(private readonly closes: MonthlyCloseService) {}

  @Post('close')
  @HttpCode(200)
  close(@Body() dto: ClosePeriodDto) {
    return this.closes.closeFromOwner(dto.period, dto.force ?? false)
  }
}
