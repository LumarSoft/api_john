import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { FeatureKeyParamDto, UpdateFeatureRolesDto } from './dto/update-feature-roles.dto'
import { PlanFeaturesService } from './plan-features.service'

/** The owner decides, besides the plan, which roles may use each function (Facturación → Planes). */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/plan-features/roles')
export class OwnerPlanFeaturesController {
  constructor(private readonly planFeatures: PlanFeaturesService) {}

  @Get()
  async list() {
    return { roles: await this.planFeatures.roles() }
  }

  @Patch(':key')
  update(@Param() params: FeatureKeyParamDto, @Body() dto: UpdateFeatureRolesDto) {
    return this.planFeatures.setRoles(params.key, dto)
  }
}
