import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class GetBalanceDto {
  // Closed months to show, the last one being the month before the current.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  producerCodeId?: number

  // Section filter "número/sucursal": a PhoneNumber id, resolved to the codes it serves.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  phoneNumberId?: number
}
