import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard'

interface AuthenticatedRequest {
  user?: { type?: string }
}

@Injectable()
export class ClientAuthGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean
    if (!authenticated) return false

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (request.user?.type !== 'client') {
      throw new ForbiddenException('Client access required')
    }

    return true
  }
}
