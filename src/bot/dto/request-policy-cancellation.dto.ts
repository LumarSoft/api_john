import { IsInt, Min } from 'class-validator'

export class RequestPolicyCancellationDto {
  @IsInt()
  @Min(1)
  polizaId: number
}
