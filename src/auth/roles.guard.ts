import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from 'generated/prisma/client'
import { ROLES_KEY } from './roles.decorator'

interface RequestWithUser {
  user?: { role?: Role }
}

/**
 * Enforces @Roles(...) metadata. Must run AFTER an auth guard that populates
 * `req.user` (e.g. UserAuthGuard). If no @Roles is set, the route is allowed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const { user } = context.switchToHttp().getRequest<RequestWithUser>()
    // The platform OWNER is a super-superadmin: it satisfies every @Roles gate
    // (including SUPERADMIN-only routes) without being listed explicitly.
    if (user?.role === Role.OWNER) return true
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role')
    }
    return true
  }
}
