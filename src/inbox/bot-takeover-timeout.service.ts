import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { type ActiveClosure, computeStatus, parseSchedule } from '../business-hours/schedule'
import { InboxService } from './inbox.service'
import { NovedadesService } from '../novedades/novedades.service'
import { NovedadType } from '../novedades/dto/list-novedades.dto'

const DEFAULT_OPERATOR_IDLE_MINUTES = 30
const DEFAULT_QUIET_MINUTES = 120
const DEFAULT_MAX_MINUTES = 120
const DEFAULT_UNANSWERED_ALERT_MINUTES = 30

/** The customer's last line, as the office reads it in the alert. */
const UNANSWERED_CLIP = 120

type PausedConversation = {
  id: number
  waId: string
  phoneNumberId: string | null
  handedOverAt: Date | null
  producerId: number
  producerCodeId: number | null
  clientId: number | null
  contactName: string | null
  client: { firstName: string; lastName: string } | null
  producer: { businessHours: unknown } | null
}

type CustomerMessage = { createdAt: Date; content: string }

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
 * (BOT_TAKEOVER_MAX_MINUTES, default 2 h: the bot steps aside two hours after a
 * person's last reply, 28/10). Outside business hours nobody is
 * going to answer, so the original rule applies: back to the bot after
 * BOT_TAKEOVER_TIMEOUT_MINUTES (default 30) without an operator reply.
 *
 * Human activity = the takeover itself, an inbox reply (role "agent") or an
 * app reply (source "app_echo").
 *
 * While the chat is the office's, nobody watches it for them: a customer of
 * Roldán wrote at 14:30, the bot stayed out (the person had written at 12:48)
 * and the person saw it the next afternoon (conv 216, 5/11). So the same sweep
 * raises a matter in "Asuntos pendientes" once a customer's message has gone
 * BOT_UNANSWERED_ALERT_MINUTES (default 30) without a reply from anyone. The
 * office answering resolves it, like any other matter of the chat.
 */
@Injectable()
export class BotTakeoverTimeoutService {
  private readonly logger = new Logger(BotTakeoverTimeoutService.name)
  private readonly operatorIdleMs: number
  private readonly quietMs: number
  private readonly maxMs: number
  private readonly unansweredMs: number
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
    private readonly novedades: NovedadesService,
    config: ConfigService,
  ) {
    this.operatorIdleMs = minutes(config.get<string>('BOT_TAKEOVER_TIMEOUT_MINUTES'), DEFAULT_OPERATOR_IDLE_MINUTES)
    this.quietMs = minutes(config.get<string>('BOT_TAKEOVER_QUIET_MINUTES'), DEFAULT_QUIET_MINUTES)
    this.maxMs = minutes(config.get<string>('BOT_TAKEOVER_MAX_MINUTES'), DEFAULT_MAX_MINUTES)
    this.unansweredMs = minutes(config.get<string>('BOT_UNANSWERED_ALERT_MINUTES'), DEFAULT_UNANSWERED_ALERT_MINUTES)
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseIdleTakeovers(now = new Date()): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const paused: PausedConversation[] = await this.prisma.conversation.findMany({
        where: { botPaused: true, deletedAt: null },
        select: {
          id: true,
          waId: true,
          phoneNumberId: true,
          handedOverAt: true,
          producerId: true,
          producerCodeId: true,
          clientId: true,
          contactName: true,
          client: { select: { firstName: true, lastName: true } },
          producer: { select: { businessHours: true } },
        },
      })

      // A branch's number may keep its own hours; the rest use the organization's.
      // A holiday of the chat's number is closed like a night: nobody is going to answer.
      const numberHours = await this.numberSchedules(paused.map(c => c.phoneNumberId))
      const numberClosures = await this.numberClosures(
        paused.map(c => c.phoneNumberId),
        new Date(now.getTime() - 24 * 60 * 60_000),
      )

      let released = 0
      for (const conversation of paused) {
        const lastHuman = await this.lastHumanActivity(conversation.id, conversation.handedOverAt)
        const lastCustomer = await this.lastCustomerMessage(conversation.id)
        const closures = (conversation.phoneNumberId && numberClosures.get(conversation.phoneNumberId)) || []
        const hours =
          (conversation.phoneNumberId && numberHours.get(conversation.phoneNumberId)) ??
          conversation.producer?.businessHours
        const reason = this.releaseReason(lastHuman, lastCustomer?.createdAt ?? null, hours, now, closures)
        if (!reason) {
          await this.alertUnanswered(conversation, lastHuman, lastCustomer, now)
          continue
        }
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
  /** Each number's closures that may be active now, by Meta phone number ID. */
  private async numberClosures(phoneNumberIds: (string | null)[], since: Date): Promise<Map<string, ActiveClosure[]>> {
    const ids = [...new Set(phoneNumberIds.filter((id): id is string => !!id))]
    if (!ids.length) return new Map()
    const rows = await this.prisma.businessClosure.findMany({
      where: { deletedAt: null, endDate: { gte: since }, phoneNumber: { phoneNumberId: { in: ids } } },
      select: { startDate: true, endDate: true, reason: true, phoneNumber: { select: { phoneNumberId: true } } },
    })
    const byNumber = new Map<string, ActiveClosure[]>()
    for (const r of rows) {
      const key = r.phoneNumber?.phoneNumberId
      if (!key) continue
      const list = byNumber.get(key) ?? []
      list.push({
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        reason: r.reason,
      })
      byNumber.set(key, list)
    }
    return byNumber
  }

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

  private async lastCustomerMessage(conversationId: number): Promise<CustomerMessage | null> {
    const last = await this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, content: true },
    })
    return last ? { createdAt: last.createdAt, content: last.content ?? '' } : null
  }

  /**
   * The customer wrote after the person's last line and nobody has answered
   * for BOT_UNANSWERED_ALERT_MINUTES: a matter for the office, once per
   * customer message (any matter of the chat raised since it counts). Never
   * throws: the sweep goes on with the next chat.
   */
  private async alertUnanswered(
    conversation: PausedConversation,
    lastHuman: Date | null,
    lastCustomer: CustomerMessage | null,
    now: Date,
  ): Promise<void> {
    if (!lastCustomer) return
    if (lastHuman && lastCustomer.createdAt <= lastHuman) return
    if (now.getTime() - lastCustomer.createdAt.getTime() < this.unansweredMs) return
    try {
      const raised = await this.prisma.notification.findFirst({
        where: {
          refId: conversation.id,
          type: NovedadType.HANDOFF,
          deletedAt: null,
          createdAt: { gte: lastCustomer.createdAt },
        },
        select: { id: true },
      })
      if (raised) return
      const name = conversation.client
        ? `${conversation.client.firstName} ${conversation.client.lastName}`.trim()
        : (conversation.contactName ?? conversation.waId)
      const at = lastCustomer.createdAt.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      const line = lastCustomer.content.replace(/\s+/g, ' ').trim()
      const quoted = line.length > UNANSWERED_CLIP ? `${line.slice(0, UNANSWERED_CLIP - 1)}…` : line
      await this.novedades.recordHandoff(conversation.producerId, {
        conversationId: conversation.id,
        clientId: conversation.clientId,
        clienteNombre: name,
        producerCodeId: conversation.producerCodeId,
        phoneNumberId: conversation.phoneNumberId,
        reason: `Sin respuesta desde las ${at} en un chat que atiende la oficina: "${quoted}"`,
      })
      this.logger.log(`Conversation ${conversation.id}: customer unanswered since ${at}, office alerted`)
    } catch (error) {
      this.logger.error(
        `Could not alert the unanswered customer of conversation ${conversation.id}: ${(error as Error).message}`,
      )
    }
  }
}

function minutes(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 60_000
}
