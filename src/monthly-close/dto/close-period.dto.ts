import { IsBoolean, IsOptional, Matches } from 'class-validator'

/** The past month the owner closes by hand ("YYYY-MM"); `force` recomputes a month already closed. */
export class ClosePeriodDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period debe ser un mes YYYY-MM' })
  period: string

  @IsOptional()
  @IsBoolean()
  force?: boolean
}
