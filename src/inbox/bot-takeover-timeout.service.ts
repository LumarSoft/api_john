import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { InboxService } from './inbox.service'

const DEFAULT_TIMEOUT_MINUTES = 30

/**
 * Gives a conversation back to the bot once the human who took it over stops
 * answering. A takeover (from the inbox, or an employee replying from the
 * WhatsApp Business app) pauses the bot; until now only the "Devolver al bot"
 * button resumed it, so a forgotten takeover left the customer unanswered.
 *
 * Human activity = the takeover itself, an inbox reply (role "agent") or an
 * app reply (source "app_echo"). Customer messages don't count: the point is
 * that nobody on our side is answering them. Configurable with
 * BOT_TAKEOVER_TIMEOUT_MINUTES (default 30).
 */
@Injectable()
export class BotTakeoverTimeoutService {
  private readonly logger = new Logger(BotTakeoverTimeoutService.name)
  private readonly timeoutMs: number
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    config: ConfigService,
  ) {
    const minutes = Number(config.get<string>('BOT_TAKEOVER_TIMEOUT_MINUTES'))
    this.timeoutMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MINUTES) * 60_000
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseIdleTakeovers(now = new Date()): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const paused = await this.prisma.conversation.findMany({
        where: { botPaused: true, deletedAt: null },
        select: { id: true, waId: true, phoneNumberId: true, handedOverAt: true },
      })

      let released = 0
      for (const conversation of paused) {
        const lastHuman = await this.lastHumanActivity(conversation.id, conversation.handedOverAt)
        if (lastHuman && now.getTime() - lastHuman.getTime() < this.timeoutMs) continue
        if (await this.inbox.autoReleaseToBot(conversation)) {
          released++
          this.logger.log(`Conversation ${conversation.id} returned to the bot after operator inactivity`)
        }
      }
      return released
    } catch (error) {
      this.logger.error(`Takeover timeout sweep failed: ${(error as Error).message}`)
      return 0
    } finally {
      this.running = false
    }
  }

  private async lastHumanActivity(conversationId: number, handedOverAt: Date | null): Promise<Date | null> {
    const lastReply = await this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null, OR: [{ role: 'agent' }, { source: 'app_echo' }] },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const times = [handedOverAt, lastReply?.createdAt].filter((d): d is Date => d instanceof Date)
    return times.length ? new Date(Math.max(...times.map(d => d.getTime()))) : null
  }
}
