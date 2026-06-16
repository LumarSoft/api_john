import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard'

interface AuthenticatedRequest {
  user?: { type?: string }
}

/** Restricts a route to employee/admin JWTs (type "user") — client tokens are rejected. */
@Injectable()
export class UserAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean
    if (!authenticated) return false

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (request.user?.type !== 'user') {
      throw new ForbiddenException('User access required')
    }

    return true
  }
}
