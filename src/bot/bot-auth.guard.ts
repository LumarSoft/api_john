import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * Guards the /bot/* endpoints. The WhatsApp bot authenticates with a shared
 * secret sent in the `x-bot-secret` header — the same value must be configured
 * as BOT_SECRET in both api/.env and whatsapp-bot-seguros/.env.
 */
@Injectable()
export class BotAuthGuard implements CanActivate {
  private readonly logger = new Logger(BotAuthGuard.name)

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.configService.get<string>('BOT_SECRET')

    if (!secret) {
      this.logger.warn('BOT_SECRET is not configured — rejecting all bot requests')
      throw new UnauthorizedException('Bot access is not configured')
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    if (request.headers['x-bot-secret'] !== secret) {
      throw new UnauthorizedException('Invalid bot secret')
    }

    return true
  }
}
