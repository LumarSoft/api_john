import { IsBoolean } from 'class-validator'

export class UpdateMotoCoverageDto {
  /** Whether the organization offers this coverage when it quotes a motorcycle. */
  @IsBoolean()
  isActive: boolean
}
