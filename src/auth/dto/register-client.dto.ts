import { IsEmail, IsString, IsInt, IsOptional, MinLength } from 'class-validator'

export class RegisterClientDto {
  @IsEmail()
  email: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string

  @IsInt()
  producerId: number

  @IsString()
  dni: string

  @IsString()
  firstName: string

  @IsString()
  lastName: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  city?: string
}
