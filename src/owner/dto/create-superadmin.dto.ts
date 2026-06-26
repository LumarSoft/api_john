import { IsEmail, IsString, MinLength } from 'class-validator'

/** Owner creates an additional SuperAdmin for an organization. */
export class CreateSuperAdminDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(6)
  password: string
}
