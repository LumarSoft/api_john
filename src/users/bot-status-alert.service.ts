import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { BUSINESS_TZ } from '../business-hours/schedule'

export interface BotStatusChangeEvent {
  producerId: number
  producerName: string
  botEnabled: boolean
  /** Email of the admin who flipped the switch; null when unknown. */
  actorEmail: string | null
  at: Date
  /** When the previous flip happened, to say how long the bot was in the other state. */
  since: Date | null
}

/**
 * Tells the owner when someone turns the organization-wide bot off or on.
 *
 * The office switched the bot off every morning for a week and nobody knew
 * until the logs were read. The audit row is always written (see
 * UsersService.setBotEnabled); this service is the announcement on top of it,
 * on whichever channels are configured:
 *
 *   - email:    BOT_STATUS_ALERT_EMAIL (one or more addresses, comma-separated)
 *   - WhatsApp: BOT_STATUS_ALERT_PHONE + BOT_STATUS_ALERT_TEMPLATE, an approved
 *               Meta template with three body variables {{1}} who, {{2}} what
 *               ("desactivó"/"activó"), {{3}} when — sent from the organization's
 *               active number through the bot, like the quote follow-up.
 *
 * With neither configured the message is only logged, so the wording can be
 * reviewed before choosing the channel. Never throws: an alert must not undo
 * the switch.
 */
@Injectable()
export class BotStatusAlertService {
  private readonly logger = new Logger(BotStatusAlertService.name)
  private readonly emails: string[]
  private readonly phone: string | undefined
  private readonly template: string | undefined
  private readonly templateLang: string
  private readonly botUrl: string
  private readonly botSecret: string

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.emails = (config.get<string>('BOT_STATUS_ALERT_EMAIL') ?? '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean)
    this.phone = config.get<string>('BOT_STATUS_ALERT_PHONE') || undefined
    this.template = config.get<string>('BOT_STATUS_ALERT_TEMPLATE') || undefined
    this.templateLang = config.get<string>('BOT_STATUS_ALERT_TEMPLATE_LANG') ?? 'es_AR'
    this.botUrl = config.get<string>('BOT_URL') ?? 'http://localhost:3002'
    this.botSecret = config.get<string>('BOT_SECRET') ?? ''
  }

  async notify(event: BotStatusChangeEvent): Promise<void> {
    const copy = buildCopy(event)
    const channels: Promise<void>[] = []
    if (this.emails.length > 0) channels.push(this.sendEmail(copy))
    if (this.phone && this.template) channels.push(this.sendWhatsApp(event, copy))

    if (channels.length === 0) {
      this.logger.warn(`BOT_STATUS_ALERT_* not set — alert only logged: ${copy.subject}. ${copy.text}`)
      return
    }
    await Promise.all(channels)
  }

  private async sendEmail(copy: AlertCopy): Promise<void> {
    try {
      await this.mail.sendAlert({ to: this.emails, subject: copy.subject, text: copy.text, html: copy.html })
    } catch (err) {
      this.logger.error(`Bot status alert email failed: ${(err as Error).message}`)
    }
  }

  private async sendWhatsApp(event: BotStatusChangeEvent, copy: AlertCopy): Promise<void> {
    try {
      const phoneNumber = await this.prisma.phoneNumber.findFirst({
        where: { producerId: event.producerId, isActive: true, deletedAt: null },
        select: { phoneNumberId: true },
      })
      if (!phoneNumber) {
        this.logger.warn(`Bot status alert: producer ${event.producerId} has no active WhatsApp number`)
        return
      }
      const res = await fetch(`${this.botUrl}/internal/send-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': this.botSecret },
        body: JSON.stringify({
          to: this.phone,
          phoneNumberId: phoneNumber.phoneNumberId,
          template: this.template,
          lang: this.templateLang,
          params: copy.templateParams,
        }),
      })
      if (!res.ok) {
        this.logger.error(`Bot status alert WhatsApp failed (${res.status}): ${await res.text().catch(() => '')}`)
        return
      }
      this.logger.log(`Bot status alert sent by WhatsApp to ${this.phone}`)
    } catch (err) {
      this.logger.error(`Bot status alert WhatsApp failed: ${(err as Error).message}`)
    }
  }
}

interface AlertCopy {
  subject: string
  text: string
  html: string
  templateParams: string[]
}

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "2 h 15 min", "45 min", "3 días" — how long the previous state lasted. */
export function formatDuration(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const rest = minutes % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
  }
  return `${Math.round(hours / 24)} días`
}

/** The announcement in the owner's words. Exported for tests and copy review. */
export function buildCopy(event: BotStatusChangeEvent): AlertCopy {
  const who = event.actorEmail ?? 'Alguien del equipo'
  const date = dateFmt.format(event.at)
  const time = timeFmt.format(event.at)
  const when = `el ${date} a las ${time}`
  const previous = event.since
    ? event.botEnabled
      ? ` Estuvo desactivado ${formatDuration(event.since, event.at)}.`
      : ` Había estado activo ${formatDuration(event.since, event.at)}.`
    : ''

  if (!event.botEnabled) {
    const subject = `⚠️ Bot de WhatsApp desactivado — ${event.producerName}`
    const text =
      `${who} desactivó el bot de WhatsApp de ${event.producerName} ${when}.${previous} ` +
      'Mientras esté desactivado, los mensajes de los clientes se guardan en la bandeja pero nadie les responde automáticamente.'
    return { subject, text, html: toHtml(subject, text), templateParams: [who, 'desactivó', `${date} ${time}`] }
  }

  const subject = `✅ Bot de WhatsApp reactivado — ${event.producerName}`
  const text = `${who} volvió a activar el bot de WhatsApp de ${event.producerName} ${when}.${previous} Los clientes vuelven a recibir respuesta automática.`
  return { subject, text, html: toHtml(subject, text), templateParams: [who, 'activó', `${date} ${time}`] }
}

function toHtml(title: string, text: string): string {
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `
    <div style="font-family: Arial, sans-serif; color: #1a1a1a; max-width: 560px;">
      <h2 style="margin: 0 0 12px;">${escape(title)}</h2>
      <p style="margin: 0; font-size: 14px; line-height: 1.5;">${escape(text)}</p>
    </div>
  `
}
