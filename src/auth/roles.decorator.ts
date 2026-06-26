import { SetMetadata } from '@nestjs/common'
import { Role } from 'generated/prisma/client'

export const ROLES_KEY = 'roles'

/**
 * Restricts a route to the given roles. Use together with UserAuthGuard + RolesGuard.
 * Example: `@Roles(Role.SUPERADMIN)` on user-management endpoints.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
