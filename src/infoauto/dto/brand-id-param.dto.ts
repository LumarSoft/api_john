import { IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class BrandIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  brandId: number
}
