import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { ScopeUser } from '../common/scope/scope.service'
import { AssistantService } from './assistant.service'

/**
 * Every assistant route needs the assistant in the person's plan and role, not
 * only asking: the owner may take it off a plan or a role while a proposal is
 * waiting, and from then on it can't be confirmed nor the history read. Runs
 * after UserAuthGuard, which loads the user from the database.
 */
@Injectable()
export class AssistantEnabledGuard implements CanActivate {
  constructor(private readonly assistant: AssistantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{ user: ScopeUser }>()
    await this.assistant.assertEnabled(user)
    return true
  }
}
