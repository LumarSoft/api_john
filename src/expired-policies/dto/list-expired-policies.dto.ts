import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CobranzasScopeDto } from '../../clients/dto/list-cobranzas.dto'

export enum ExpiredPolicySort {
  /** Longest expired first (default): the ones the office is most behind on. */
  OLDEST = 'oldest',
  /** Most recently expired first. */
  RECENT = 'recent',
}

export class ListExpiredPoliciesDto extends CobranzasScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  // The policies the office hid ("no renueva"), to review or bring back.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hidden?: boolean

  @IsOptional()
  @IsEnum(ExpiredPolicySort)
  sort?: ExpiredPolicySort

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
