import { IsString, Matches } from 'class-validator'

export class MotoCoverageParamsDto {
  /** A code of the motorcycle catalog (A, B4, B1 or B); checked against it in the service. */
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9]{0,4}$/)
  code: string
}
