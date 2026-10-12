import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'
import { ImprovementArea } from 'generated/prisma/client'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export class CreateImprovementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  title: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  summary: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  beforeText?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  afterText?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  example?: string

  @IsEnum(ImprovementArea)
  area: ImprovementArea

  /** Date of the change shown on the card, YYYY-MM-DD. Null/omitted = the publication date. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: 'releasedOn must be YYYY-MM-DD' })
  releasedOn?: string | null

  /** Organization that sees it. Null or omitted = every organization. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  producerId?: number | null

  /** True publishes it right away; otherwise it stays a draft. */
  @IsOptional()
  @IsBoolean()
  published?: boolean
}

export class UpdateImprovementDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  title?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  beforeText?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  afterText?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  example?: string

  @IsOptional()
  @IsEnum(ImprovementArea)
  area?: ImprovementArea

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: 'releasedOn must be YYYY-MM-DD' })
  releasedOn?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  producerId?: number | null

  /** True publishes (keeping the original date if it was already published); false turns it back into a draft. */
  @IsOptional()
  @IsBoolean()
  published?: boolean
}
