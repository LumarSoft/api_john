import { IsEmail, IsString, IsInt, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(6)
  password: string

  @IsInt()
  producerId: number
}
