import { IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class GroupParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  brandId: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId: number
}
