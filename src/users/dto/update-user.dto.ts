import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator'
import { Role } from 'generated/prisma/client'

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string

  @IsOptional()
  @IsEnum(Role)
  role?: Role

  // When provided, replaces the user's full set of producer-code grants.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  producerCodeIds?: number[]

  /** How the office calls this person ("Mili"); empty = show the email. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string
}
