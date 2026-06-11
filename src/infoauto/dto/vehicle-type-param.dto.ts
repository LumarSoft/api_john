import { IsIn } from 'class-validator'
import { VEHICLE_TYPE_PARAMS, type VehicleTypeParam } from '../infoauto.types'

export class VehicleTypeParamDto {
  @IsIn(VEHICLE_TYPE_PARAMS)
  vehicleType: VehicleTypeParam
}
