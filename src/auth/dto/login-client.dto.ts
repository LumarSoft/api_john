import { IsEmail, IsString, IsInt } from 'class-validator'

export class LoginClientDto {
  @IsEmail()
  email: string

  @IsString()
  password: string

  @IsInt()
  producerId: number
}
