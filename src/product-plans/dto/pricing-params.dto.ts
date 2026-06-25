import { IsIn } from 'class-validator'
import { FIXED_PRODUCT_TYPES, type FixedProductType } from '../../solicitudes/solicitudes.types'

export class PricingParamsDto {
  @IsIn(FIXED_PRODUCT_TYPES)
  productType: FixedProductType
}
