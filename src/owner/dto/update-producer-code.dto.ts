import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** Owner edits a producer code (rename or activate/deactivate). */
export class UpdateProducerCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
