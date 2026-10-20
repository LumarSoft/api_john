import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readFile } from 'fs/promises'

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
    if (!res.ok) await this.failDelivery(res, '/internal/send', 'Could not deliver message via WhatsApp')
  }

  /** Delivers a stored photo or PDF; the bot uploads it to Meta and sends it. */
  async sendMedia(params: {
    to: string
    phoneNumberId: string
    path: string
    mimeType: string
    filename: string
    caption?: string
  }): Promise<void> {
    const form = new FormData()
    form.append('to', params.to)
    form.append('phoneNumberId', params.phoneNumberId)
    if (params.caption) form.append('caption', params.caption)
    // Sent as a text field too: multipart filenames reach the bot as latin1 and
    // would garble an accented name ("Póliza.pdf") shown to the client.
    form.append('filename', params.filename)
    form.append('file', new Blob([await readFile(params.path)], { type: params.mimeType }), params.filename)

    const res = await fetch(`${this.botUrl}/internal/send-media`, {
      method: 'POST',
      headers: { 'x-bot-secret': this.botSecret },
      body: form,
    })
    if (!res.ok) await this.failDelivery(res, '/internal/send-media', 'Could not deliver the file via WhatsApp')
  }

  /**
   * The bot answers a rejected send with 502 and a message written for the agent
   * ("el número está desconectado…", "pasaron más de 24 h…"). Pass that through
   * so the panel can show why; anything else stays a generic 500.
   */
  private async failDelivery(res: Response, path: string, fallback: string): Promise<never> {
    const body = await res.text().catch(() => '')
    this.logger.error(`Bot ${path} failed (${res.status}): ${body}`)
    const reason = res.status === 502 ? readMessage(body) : null
    throw reason ? new BadGatewayException(reason) : new InternalServerErrorException(fallback)
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

/** The `message` of a NestJS error body, or null when there is none. */
function readMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    return typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message : null
  } catch {
    return null
  }
}
