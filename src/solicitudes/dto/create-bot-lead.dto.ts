import { Type } from 'class-transformer'
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ALL_PRODUCT_TYPES } from '../solicitudes.types'

/**
 * Lead created by the WhatsApp bot. Same fields as CreateLeadDto, but it also
 * accepts auto/moto: after an online quote the customer picks a coverage in the
 * chat, and that request to take it out lands in the Solicitudes panel as a
 * lead (the web keeps its own auto/moto Solicitud flow).
 */
export class CreateBotLeadDto {
  @IsIn(ALL_PRODUCT_TYPES)
  productType: (typeof ALL_PRODUCT_TYPES)[number]

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

  @IsObject()
  payload: Record<string, unknown>

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  selectedPlanId?: number
}
