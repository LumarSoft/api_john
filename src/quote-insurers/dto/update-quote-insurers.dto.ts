import { IsBoolean, IsOptional } from 'class-validator'

/** Switches the insurers the organization's bot quotes with; what is left out stays as it is. */
export class UpdateQuoteInsurersDto {
  @IsOptional()
  @IsBoolean()
  triunfo?: boolean

  @IsOptional()
  @IsBoolean()
  sancor?: boolean
}
