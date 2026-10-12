import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ClaimStatus } from 'generated/prisma/client'

export { ClaimStatus }

export class ListSiniestrosDto {
  @IsOptional()
  @IsEnum(ClaimStatus)
  estado?: ClaimStatus

  // Matches client first/last name, DNI or poliza certificado
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

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
