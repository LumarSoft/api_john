import { Type } from 'class-transformer'
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** The month of the settlement ("YYYY-MM", default the running one). */
export class SettlementQueryDto {
  @IsOptional()
  @Matches(PERIOD, { message: 'period debe ser un mes YYYY-MM' })
  period?: string
}

/** The months of the series: `months` months (default 12) ending at `to` ("YYYY-MM", default the running one). */
export class SettlementSeriesQueryDto {
  @IsOptional()
  @Matches(PERIOD, { message: 'to debe ser un mes YYYY-MM' })
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number
}
