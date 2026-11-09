import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export enum CollectionStatusFilter {
  VENCIDAS = 'vencidas',
  RECHAZADAS = 'rechazadas',
  PENDIENTES = 'pendientes',
  TODAS = 'todas',
}

/** The filters the cobranzas list and its stats share, so the KPIs follow the list. */
export class CobranzasScopeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerCodeId?: number

  // SuperAdmin "filter by número/sucursal" — a PhoneNumber id; resolves to the
  // producer codes that number serves.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  phoneNumberId?: number

  // Triunfo's medio de pago as stored on the policy ("Plan De Pago",
  // "Convenio", "Débito Tarjeta"…); the stats list the values in scope.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentMethod?: string
}

export class ListCobranzasDto extends CobranzasScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @IsEnum(CollectionStatusFilter)
  status?: CollectionStatusFilter

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
