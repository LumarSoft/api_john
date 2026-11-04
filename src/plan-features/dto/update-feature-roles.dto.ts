import { IsBoolean, IsIn, IsOptional } from 'class-validator'
import { PLAN_FEATURES, type PlanFeatureKey } from '../plan-features'

export class FeatureKeyParamDto {
  @IsIn(PLAN_FEATURES.map(f => f.key))
  key: PlanFeatureKey
}

/** Turn a function on or off for administrators and/or SuperAdmins; what is left out stays. */
export class UpdateFeatureRolesDto {
  @IsOptional()
  @IsBoolean()
  ADMIN?: boolean

  @IsOptional()
  @IsBoolean()
  SUPERADMIN?: boolean
}
