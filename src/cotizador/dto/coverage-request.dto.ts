import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'

export const PERSON_TYPES = ['FISICA', 'JURIDICA'] as const
export const DOC_TYPES = ['DNI', 'CUIL', 'CUIT', 'PASAPORTE'] as const
export const PAYMENT_METHODS = ['CREDIT', 'DEBIT', 'OTHER'] as const

export class CoverageRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  coverage: string

  @IsDateString()
  startDate: string

  @IsIn(PERSON_TYPES)
  personType: (typeof PERSON_TYPES)[number]

  // Razón social when personType is JURIDICA
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string

  @IsEmail()
  email: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  phone: string

  @IsOptional()
  @IsDateString()
  birthDate?: string

  @IsIn(DOC_TYPES)
  docType: (typeof DOC_TYPES)[number]

  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  docNumber: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  address: string

  @IsIn(PAYMENT_METHODS)
  paymentMethod: (typeof PAYMENT_METHODS)[number]

  // Card fields are required for CREDIT/DEBIT; OTHER is handled offline by an agent
  @ValidateIf(dto => dto.paymentMethod !== 'OTHER')
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  cardCompany?: string

  @ValidateIf(dto => dto.paymentMethod !== 'OTHER')
  @Matches(/^\d{13,19}$/)
  cardNumber?: string

  // YYYYMM — the format Triunfo expects in FormaPago.DebitoTarjeta.Vencimiento
  @ValidateIf(dto => dto.paymentMethod !== 'OTHER')
  @Matches(/^\d{4}(0[1-9]|1[0-2])$/)
  cardExpiry?: string

  @ValidateIf(dto => dto.paymentMethod !== 'OTHER')
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  cardHolder?: string
}
