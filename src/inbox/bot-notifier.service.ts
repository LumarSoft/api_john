import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * Thin HTTP client from the API to the bot process.
 * The bot is the only one allowed to talk to the Meta Graph API; when an admin
 * agent sends a message the API delegates the actual WhatsApp delivery here.
 */
@Injectable()
export class BotNotifierService {
  private readonly logger = new Logger(BotNotifierService.name)
  private readonly botUrl: string
  private readonly botSecret: string

  constructor(config: ConfigService) {
    this.botUrl = config.get<string>('BOT_URL') ?? 'http://localhost:3002'
    this.botSecret = config.get<string>('BOT_SECRET') ?? ''
  }

  async sendMessage(to: string, text: string, phoneNumberId: string): Promise<void> {
    const res = await fetch(`${this.botUrl}/internal/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': this.botSecret,
      },
      body: JSON.stringify({ to, text, phoneNumberId }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      this.logger.error(`Bot /internal/send failed (${res.status}): ${body}`)
      throw new InternalServerErrorException('Could not deliver message via WhatsApp')
    }
  }

  /**
   * Best-effort: resets the in-memory flow state so the user gets the welcome
   * menu on their next message instead of a stale mid-flow state.
   *
   * Fix #5: both fetch failures and non-2xx responses are logged explicitly so
   * stale flow states can be traced. Never throws — a failed reset is not a
   * reason to fail the release operation (the state expires on its own after 1h).
   */
  async resetFlow(phoneNumberId: string, waId: string): Promise<void> {
    try {
      const res = await fetch(`${this.botUrl}/internal/reset-flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': this.botSecret,
        },
        body: JSON.stringify({ phoneNumberId, waId }),
      })
      if (!res.ok) {
        this.logger.warn(
          `Bot /internal/reset-flow returned ${res.status} for waId=${waId} — flow state may be stale for up to 1 h`,
        )
      }
    } catch (err) {
      this.logger.warn(
        `Bot /internal/reset-flow unreachable for waId=${waId} — flow state may be stale for up to 1 h: ${(err as Error).message}`,
      )
    }
  }
}
