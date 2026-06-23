import { Type } from 'class-transformer'
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { LEAD_PRODUCT_TYPES, type LeadProductType } from '../solicitudes.types'

export class CreateLeadDto {
  @IsIn(LEAD_PRODUCT_TYPES)
  productType: LeadProductType

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contactName: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string

  // Free-form product-specific fields (actividad, superficie, bici subtype, …).
  // Stored verbatim as JSON; the admin sees them in the lead detail.
  @IsObject()
  payload: Record<string, unknown>

  // Set only for the fixed-price products (bolso, hogar): the chosen plan.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  selectedPlanId?: number
}
