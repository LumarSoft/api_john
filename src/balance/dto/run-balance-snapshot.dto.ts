import { IsBoolean, IsInt, IsOptional, Matches, Min } from 'class-validator'

export class RunBalanceSnapshotDto {
  // A closed month, "YYYY-MM".
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period debe tener el formato YYYY-MM' })
  period: string

  // Rewrites the month even when it already has a balance.
  @IsOptional()
  @IsBoolean()
  force?: boolean

  // Only this organization; all active ones when absent.
  @IsOptional()
  @IsInt()
  @Min(1)
  producerId?: number
}
