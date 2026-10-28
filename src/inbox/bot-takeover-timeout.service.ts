import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { type ActiveClosure, computeStatus, parseSchedule } from '../business-hours/schedule'
import { InboxService } from './inbox.service'

const DEFAULT_OPERATOR_IDLE_MINUTES = 30
const DEFAULT_QUIET_MINUTES = 120
const DEFAULT_MAX_MINUTES = 240

/**
 * Gives a conversation back to the bot once the human who took it over is
 * really done with it. A takeover (from the inbox, or an employee replying from
 * the WhatsApp Business app) pauses the bot; this sweep is what resumes it when
 * nobody presses "Devolver al bot".
 *
 * The first version handed the chat back 30 minutes after the operator's last
 * reply, even while the customer was still talking to her. The customer then
 * wrote "gracias" and got the welcome menu in the middle of a human
 * conversation, and the office answered by switching the whole bot off every
 * morning. So within business hours a takeover is now sticky: it ends only when
 * the conversation has gone quiet for everyone (BOT_TAKEOVER_QUIET_MINUTES,
 * default 2 h) or the operator has been silent for a long time regardless
 * (BOT_TAKEOVER_MAX_MINUTES, default 4 h). Outside business hours nobody is
 * going to answer, so the original rule applies: back to the bot after
 * BOT_TAKEOVER_TIMEOUT_MINUTES (default 30) without an operator reply.
 *
 * Human activity = the takeover itself, an inbox reply (role "agent") or an
 * app reply (source "app_echo").
 */
@Injectable()
export class BotTakeoverTimeoutService {
  private readonly logger = new Logger(BotTakeoverTimeoutService.name)
  private readonly operatorIdleMs: number
  private readonly quietMs: number
  private readonly maxMs: number
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    config: ConfigService,
  ) {
    this.operatorIdleMs = minutes(config.get<string>('BOT_TAKEOVER_TIMEOUT_MINUTES'), DEFAULT_OPERATOR_IDLE_MINUTES)
    this.quietMs = minutes(config.get<string>('BOT_TAKEOVER_QUIET_MINUTES'), DEFAULT_QUIET_MINUTES)
    this.maxMs = minutes(config.get<string>('BOT_TAKEOVER_MAX_MINUTES'), DEFAULT_MAX_MINUTES)
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseIdleTakeovers(now = new Date()): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const paused = await this.prisma.conversation.findMany({
        where: { botPaused: true, deletedAt: null },
        select: {
          id: true,
          waId: true,
          phoneNumberId: true,
          handedOverAt: true,
          producer: {
            select: {
              businessHours: true,
              // A holiday is closed like a night: nobody is going to answer.
              businessClosures: {
                where: { deletedAt: null, endDate: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
                select: { startDate: true, endDate: true, reason: true },
              },
            },
          },
        },
      })

      // A branch's number may keep its own hours; the rest use the organization's.
      const numberHours = await this.numberSchedules(paused.map(c => c.phoneNumberId))

      let released = 0
      for (const conversation of paused) {
        const lastHuman = await this.lastHumanActivity(conversation.id, conversation.handedOverAt)
        const lastCustomer = await this.lastCustomerMessage(conversation.id)
        const closures: ActiveClosure[] = (conversation.producer?.businessClosures ?? []).map(c => ({
          startDate: c.startDate.toISOString().slice(0, 10),
          endDate: c.endDate.toISOString().slice(0, 10),
          reason: c.reason,
        }))
        const hours =
          (conversation.phoneNumberId && numberHours.get(conversation.phoneNumberId)) ??
          conversation.producer?.businessHours
        const reason = this.releaseReason(lastHuman, lastCustomer, hours, now, closures)
        if (!reason) continue
        if (await this.inbox.autoReleaseToBot(conversation)) {
          released++
          this.logger.log(`Conversation ${conversation.id} returned to the bot (${reason})`)
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

  /** Weekly hours of the numbers that have their own, by Meta phone number ID. */
  private async numberSchedules(phoneNumberIds: (string | null)[]): Promise<Map<string, unknown>> {
    const ids = [...new Set(phoneNumberIds.filter((id): id is string => !!id))]
    if (!ids.length) return new Map()
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { phoneNumberId: { in: ids } },
      select: { phoneNumberId: true, businessHours: true },
    })
    return new Map(numbers.filter(n => n.businessHours != null).map(n => [n.phoneNumberId, n.businessHours]))
  }

  /**
   * Why the conversation should go back to the bot now, or null to keep the
   * human on it. Exposed for tests.
   */
  releaseReason(
    lastHuman: Date | null,
    lastCustomer: Date | null,
    businessHours: unknown,
    now: Date,
    closures: ActiveClosure[] = [],
  ): string | null {
    // A legacy pause with no timestamps at all cannot be reasoned about: release it.
    if (!lastHuman) return 'no takeover timestamps'

    const operatorIdle = now.getTime() - lastHuman.getTime()
    if (operatorIdle < this.operatorIdleMs) return null

    // Nobody answers outside business hours: the customer is better off with the bot.
    if (!computeStatus(parseSchedule(businessHours), closures, now).isOpenNow) {
      return 'operator idle outside business hours'
    }

    const lastAny = lastCustomer && lastCustomer > lastHuman ? lastCustomer : lastHuman
    const quiet = now.getTime() - lastAny.getTime()
    if (quiet >= this.quietMs) return `conversation quiet for ${Math.round(quiet / 60_000)} min`
    if (operatorIdle >= this.maxMs) return `operator silent for ${Math.round(operatorIdle / 60_000)} min`
    return null
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

  private async lastCustomerMessage(conversationId: number): Promise<Date | null> {
    const last = await this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    return last?.createdAt ?? null
  }
}

function minutes(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 60_000
}
