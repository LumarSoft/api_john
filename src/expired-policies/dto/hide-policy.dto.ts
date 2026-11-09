import { IsOptional, IsString, MaxLength } from 'class-validator'

export class HidePolicyDto {
  // Why it will not be renewed, in the office's words ("Vendió el auto").
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string
}
