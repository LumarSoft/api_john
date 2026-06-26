import { Type } from 'class-transformer'
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

/** A producer code to create together with the organization. */
class OrgCodeInput {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string
}

/**
 * Owner-only payload to provision a brand-new organization (tenant): the Producer
 * itself + its first SuperAdmin + (optionally) its Triunfo producer codes.
 */
export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  // The organization's principal Triunfo code (e.g. "11425"). If provided it is
  // created as the master ProducerCode automatically.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  masterCode?: string

  // Display name the WhatsApp bot uses to introduce itself for this org.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  botName?: string

  // ── First SuperAdmin of the organization ──
  @IsEmail()
  adminEmail: string

  @IsString()
  @MinLength(6)
  adminPassword: string

  // Optional extra dependent codes (besides the master) to seed up-front.
  @IsOptional()
  @IsArray()
  @ArrayUnique(c => c.code)
  @ValidateNested({ each: true })
  @Type(() => OrgCodeInput)
  codes?: OrgCodeInput[]
}
