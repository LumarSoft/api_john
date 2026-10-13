import { IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string

  /** How the office calls this person ("Mili"); empty = show the email. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string
}
