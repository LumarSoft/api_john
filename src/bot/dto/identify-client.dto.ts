import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// At least one of dni/plate is required — enforced in the service so the
// error message can be domain-specific.
export class IdentifyClientDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(11)
  dni?: string

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(10)
  plate?: string
}
