import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class InfoAutoQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query_string?: string

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
  page_size?: number
}
