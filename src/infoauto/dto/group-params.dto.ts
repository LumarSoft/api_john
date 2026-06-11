import { IsInt, IsIn, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { VEHICLE_TYPE_PARAMS, type VehicleTypeParam } from '../infoauto.types'

export class GroupParamsDto {
  @IsIn(VEHICLE_TYPE_PARAMS)
  vehicleType: VehicleTypeParam

  @Type(() => Number)
  @IsInt()
  @Min(1)
  brandId: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId: number
}
