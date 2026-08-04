import { Type } from 'class-transformer'
import { ArrayUnique, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class CreatePhoneNumberDto {
  // Meta phone_number_id (the id Meta sends in webhook metadata).
  @IsString()
  @MinLength(3)
  phoneNumberId: string

  // Display number, e.g. "+54 9 11 5555-5555".
  @IsString()
  @MinLength(3)
  number: string

  // The code this number is billed to.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responsibleProducerCodeId?: number

  // Extra codes this number also serves (shared office line).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  servedCodeIds?: number[]

  // Monthly USD cap (null → platform default).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number
}
