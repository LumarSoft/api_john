import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt } from 'class-validator'

/** The policies of the worklist an action applies to. */
export class PolicyIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids: number[]
}
