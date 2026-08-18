import { Type } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'

/**
 * Payload the admin panel sends right after Embedded Signup finishes.
 *
 * `code` has a time-to-live of 30 SECONDS, so the front must post this the
 * moment the popup closes — no confirmation dialogs in between.
 */
export class OnboardWhatsappDto {
  // Exchangeable token code returned by Embedded Signup (NOT an access token).
  @IsString()
  @MinLength(10)
  code: string

  // WhatsApp Business Account the customer just shared with our app.
  @IsString()
  @MinLength(3)
  wabaId: string

  // The number Meta provisioned/connected inside that WABA.
  // Coexistence's FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING event may only carry
  // the WABA id. In that case the server resolves the number from the WABA.
  @ValidateIf(dto => !dto.isCoexistence || dto.phoneNumberId != null)
  @IsString()
  @MinLength(3)
  phoneNumberId?: string

  // Display number for the panel, e.g. "+54 9 341 275-7294". Cosmetic only:
  // routing always happens on phoneNumberId.
  @IsOptional()
  @IsString()
  number?: string

  // True when the flow was the Coexistence one (the business keeps using the
  // WhatsApp Business app on the same number).
  @IsOptional()
  @IsBoolean()
  isCoexistence?: boolean

  // Six-digit two-step verification PIN. Optional: on Coexistence the number is
  // already registered and Meta may reject the call.
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin?: string

  // Billing attribution, same semantics as POST /admin/phone-numbers.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responsibleProducerCodeId?: number

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  servedCodeIds?: number[]
}
