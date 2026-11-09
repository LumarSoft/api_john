import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DIGITS = /^\d{1,20}$/

/** Most rows one Excel brings; Triunfo's monthly files have a few dozen. */
const MAX_ROWS = 1000

/** A row of Triunfo's rejection Excel, as the panel read it. */
export class PaymentRejectionRowDto {
  /** Row in the Excel (1-based), to find it in the file. */
  @IsInt()
  @Min(1)
  rowNumber: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  holderName: string

  /** "Art." column. */
  @IsOptional()
  @IsInt()
  branch?: number

  @Matches(DIGITS, { message: 'certificateNumber must be digits' })
  certificateNumber: string

  @IsOptional()
  @IsInt()
  endorsementNumber?: number

  @IsInt()
  @Min(0)
  installmentNumber: number

  @Matches(DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate: string

  @IsNumber()
  @Min(0)
  amount: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  entity: string

  /** Last digits of the CBU or card; the panel never sends the full number. */
  @IsOptional()
  @Matches(/^\d{1,4}$/, { message: 'accountLast4 must be up to 4 digits' })
  accountLast4?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason: string

  /** "¿Cuota aún pendiente?" = SI. */
  @IsBoolean()
  stillPending: boolean

  @IsOptional()
  @IsString()
  @MaxLength(40)
  mobilePhone?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  homePhone?: string
}

export class CreatePaymentRejectionImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string

  /** The Excel's title, e.g. "Desde: 05/10/2026 Hasta: 20/10/2026". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  periodLabel?: string

  /** Triunfo code from "Intermediario: 10484 - …". */
  @IsOptional()
  @Matches(DIGITS, { message: 'producerCode must be digits' })
  producerCode?: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PaymentRejectionRowDto)
  rows: PaymentRejectionRowDto[]
}

/** The rows of an import an action applies to. */
export class PaymentRejectionIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROWS)
  @IsInt({ each: true })
  ids: number[]
}
