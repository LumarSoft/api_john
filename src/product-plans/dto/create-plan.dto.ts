import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { FIXED_PRODUCT_TYPES, type FixedProductType } from '../../solicitudes/solicitudes.types'

// A single coverage row of a plan, e.g. { label: "Incendio", category: "EDIFICIO", amount: 9000000 }.
// Rows with the same label/category align as a row across the product's plans in the comparison table.
export class CoverageItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number
}

export class CreatePlanDto {
  @IsIn(FIXED_PRODUCT_TYPES)
  productType: FixedProductType

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyPrice: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CoverageItemDto)
  coverageItems: CoverageItemDto[]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}
