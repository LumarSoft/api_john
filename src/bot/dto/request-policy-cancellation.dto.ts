import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class RequestPolicyCancellationDto {
  @IsInt()
  @Min(1)
  policyId: number

  /** Why the client wants out (sale, cost, no longer needed…), as the bot collected it. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}
