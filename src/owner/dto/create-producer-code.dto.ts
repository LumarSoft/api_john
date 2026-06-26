import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

/** Owner adds a Triunfo producer code to an existing organization. */
export class CreateProducerCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  holderName?: string

  @IsOptional()
  @IsBoolean()
  isMaster?: boolean
}
