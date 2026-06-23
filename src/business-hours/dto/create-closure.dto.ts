import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export class CreateClosureDto {
  /** First closed day (inclusive), YYYY-MM-DD. */
  @Matches(DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string

  /** Last closed day (inclusive), YYYY-MM-DD. Same as startDate for a single day. */
  @Matches(DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string

  /** Why the office is closed — required, surfaced to users by the bot. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reason!: string
}
