import { Type } from 'class-transformer'
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class UpdatePhoneNumberDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  number?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responsibleProducerCodeId?: number

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  servedCodeIds?: number[]

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
