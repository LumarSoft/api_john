import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { BillingService } from './billing.service'
import { CreateTokenPlanDto, UpdateTokenPlanDto } from './dto/token-plan.dto'

/** "Facturación" in the panel: the organization's token plans and each number's month. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  overview(@Query('period') period: string | undefined, @Request() req: AuthenticatedRequest) {
    return this.billing.overview(req.user, period || undefined)
  }

  @Get('plans')
  listPlans(@Request() req: AuthenticatedRequest) {
    // The SuperAdmin manages the catalog and sees the retired plans too.
    return this.billing.listPlans(req.user.producerId, req.user.role !== Role.ADMIN)
  }

  @Post('plans')
  @Roles(Role.SUPERADMIN)
  createPlan(@Body() dto: CreateTokenPlanDto, @Request() req: AuthenticatedRequest) {
    return this.billing.createPlan(req.user.producerId, dto)
  }

  @Patch('plans/:id')
  @Roles(Role.SUPERADMIN)
  updatePlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTokenPlanDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.billing.updatePlan(req.user.producerId, id, dto)
  }

  @Delete('plans/:id')
  @Roles(Role.SUPERADMIN)
  removePlan(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.billing.removePlan(req.user.producerId, id)
  }
}
