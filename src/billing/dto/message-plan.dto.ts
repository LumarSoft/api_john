import { Type } from 'class-transformer'
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

/**
 * A plan of the platform's catalog (owner only): a name, how many messages it
 * includes a month and its price. A price of 0 is allowed; the trial plan must
 * be free and only one can be active.
 */
export class CreateMessagePlanDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  messages: number

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  priceUsd: number

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}

export class UpdateMessagePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  messages?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  priceUsd?: number

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number
}
