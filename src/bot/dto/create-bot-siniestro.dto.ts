import { IsDateString, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateBotSiniestroDto {
  @IsInt()
  policyId: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type: string

  @IsDateString()
  occurredAt: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string
}
