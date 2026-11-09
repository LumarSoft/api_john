import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

/**
 * A plan of the platform's catalog (owner only): a name, how many messages it
 * includes a month, its price and the panel functions it includes. A price of 0
 * is allowed; the trial plan must be free and only one can be active.
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

  /** Functions to turn on or off: { "<key>": true | false } (src/plan-features/plan-features.ts). */
  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>
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

  /** Functions to turn on or off: { "<key>": true | false } (src/plan-features/plan-features.ts). */
  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>
}
