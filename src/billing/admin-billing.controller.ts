import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AssignPlanDto } from './dto/assign-plan.dto'

/** "Facturación" in the panel: each number's plan and month, and the SuperAdmin's plan assignment. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  overview(@Query('period') period: string | undefined, @Request() req: AuthenticatedRequest) {
    return this.billing.overview(req.user, period || undefined)
  }

  // ─── front_John's panel (legacy-token-fields.ts), until it redirects to Polisend ───

  /** Its Planes tab: the owner's catalog, read-only, under the old names. */
  @Get('plans')
  legacyPlans() {
    return this.billing.legacyCatalog()
  }

  @Post('plans')
  legacyCreatePlan(): never {
    return refuseLegacyCatalogChange()
  }

  @Patch('plans/:id')
  legacyUpdatePlan(): never {
    return refuseLegacyCatalogChange()
  }

  @Delete('plans/:id')
  legacyRemovePlan(): never {
    return refuseLegacyCatalogChange()
  }

  @Patch('numbers/:id/plan')
  @Roles(Role.SUPERADMIN)
  assignPlan(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignPlanDto, @Request() req: AuthenticatedRequest) {
    return this.billing.assignPlan(req.user, id, dto.planId)
  }
}

/** The catalog is the owner's now: the old panel's SuperAdmin plan editor can no longer change it. */
function refuseLegacyCatalogChange(): never {
  throw new ForbiddenException('Los planes ahora los define Lumarsoft para todas las organizaciones.')
}
