import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator'

export class CoverageOrderItemDto {
  @Type(() => Number)
  @IsInt()
  id: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder: number
}

export class ReorderCoverageSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CoverageOrderItemDto)
  items: CoverageOrderItemDto[]
}
