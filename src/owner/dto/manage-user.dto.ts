import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { Role } from 'generated/prisma/client'

/** Roles the OWNER may assign inside an organization. OWNER itself is excluded:
 *  the platform account is not a tenant-managed user and must not be created here. */
const ASSIGNABLE = [Role.SUPERADMIN, Role.ADMIN] as const
type AssignableRole = (typeof ASSIGNABLE)[number]

export class CreateOrgUserDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(6)
  password: string

  @IsEnum(ASSIGNABLE, { message: 'role must be SUPERADMIN or ADMIN' })
  role: AssignableRole
}

export class UpdateOrgUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string

  @IsOptional()
  @IsEnum(ASSIGNABLE, { message: 'role must be SUPERADMIN or ADMIN' })
  role?: AssignableRole
}
