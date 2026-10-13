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

export class CreateUserDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(6)
  password: string

  // Defaults to ADMIN when omitted. Only a SuperAdmin may create users.
  @IsOptional()
  @IsEnum(Role)
  role?: Role

  // Producer codes this admin may access. Ignored for SUPERADMIN (sees all).
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
