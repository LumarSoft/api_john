import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { BillingService } from './billing.service'
import { CreateMessagePlanDto, UpdateMessagePlanDto } from './dto/message-plan.dto'

/** The platform's side of billing (Lumar only): the catalog of plans and the month's dashboard. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner')
export class OwnerBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing')
  dashboard(@Query('period') period: string | undefined) {
    return this.billing.ownerDashboard(period || undefined)
  }

  @Get('plans')
  listPlans() {
    return this.billing.listPlans()
  }

  @Post('plans')
  createPlan(@Body() dto: CreateMessagePlanDto) {
    return this.billing.createPlan(dto)
  }

  @Patch('plans/:id')
  updatePlan(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMessagePlanDto) {
    return this.billing.updatePlan(id, dto)
  }

  @Delete('plans/:id')
  removePlan(@Param('id', ParseIntPipe) id: number) {
    return this.billing.removePlan(id)
  }
}
