import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { Cron, CronExpression } from '@nestjs/schedule'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { BUSINESS_TZ } from '../business-hours/schedule'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { connectionLostCode, describeGraphError } from './graph-errors'

/** What Meta said about the WABA in an `account_update` webhook. */
export interface AccountUpdateNotice {
  event?: string
  reason?: string
  initiatedBy?: string
}

type ProbeResult =
  | { state: 'connected'; displayPhoneNumber: string | null }
  | { state: 'disconnected'; reason: string; displayPhoneNumber: string | null }
  | { state: 'unknown' }

interface MonitoredWaba {
  id: number
  wabaId: string
  accessToken: string
  disconnectedAt: Date | null
  producer: { name: string }
  phoneNumbers: { phoneNumberId: string; number: string }[]
}

/** Meta's documented PARTNER_REMOVED event: the business left Cloud API. */
const PARTNER_REMOVED = 'PARTNER_REMOVED'

/** Phone-number statuses that mean the number cannot send or receive through the API. */
const OFFLINE_STATUSES = new Set(['DISCONNECTED', 'OFFLINE', 'DELETED', 'BANNED', 'MIGRATED'])

/**
 * Notices when a WhatsApp number drops off Cloud API — and says so out loud.
 *
 * On 19/10/2026 the production number left Coexistence (Meta: BUSINESS_DOWNGRADE,
 * initiated by the user) and nothing in the panel changed: the PARTNER_REMOVED
 * webhook carried a WABA id that matched no row, the drop was only a log line,
 * and the office kept "sending" from the inbox. Two paths now catch it:
 *
 *   · the webhook: PARTNER_REMOVED on a known WABA is trusted as is; any other
 *     lifecycle event, or a WABA id we do not store, is checked against Graph
 *   · a cron that asks Graph about every connected number every 30 minutes, in
 *     case the webhook never arrives
 *
 * A number only counts as gone on a definitive answer from Graph (the number no
 * longer exists for our token, the token lost its WhatsApp permission, or the
 * number left CLOUD_API). Timeouts and 5xx change nothing: a false alarm would
 * stop the bot, because a disconnected WABA no longer hands out its token.
 *
 * Marking is one-way. Only a successful onboarding (Admin → Números →
 * Reconectar) clears `disconnectedAt`.
 */
@Injectable()
export class WhatsappConnectionMonitorService {
  private readonly logger = new Logger(WhatsappConnectionMonitorService.name)
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly mail: MailService,
  ) {}

  private get graphBase(): string {
    const version = this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'
    return `https://graph.facebook.com/${version}`
  }

  /** Who hears about a drop: WHATSAPP_ALERT_EMAIL, else the bot-status alert list, else the advisor. */
  private get alertRecipients(): string[] {
    const raw =
      this.config.get<string>('WHATSAPP_ALERT_EMAIL') ||
      this.config.get<string>('BOT_STATUS_ALERT_EMAIL') ||
      this.config.get<string>('ADVISOR_EMAIL') ||
      ''
    return raw
      .split(',')
      .map(email => email.trim())
      .filter(Boolean)
  }

  /**
   * Entry point for the bot's `account_update` forwarding. Returns how many
   * WABAs were looked at and how many were newly marked as disconnected.
   */
  async handleAccountUpdate(wabaId: string, notice: AccountUpdateNotice) {
    // Old bot builds only forwarded PARTNER_REMOVED and sent no event name.
    const event = notice.event ?? PARTNER_REMOVED
    this.logger.warn(
      `account_update ${event} para WABA ${wabaId} · motivo ${notice.reason ?? '—'} · iniciado por ${notice.initiatedBy ?? '—'}`,
    )

    const known = await this.findMonitored({ wabaId })
    if (known.length && event === PARTNER_REMOVED) {
      const marked = await this.markDisconnected(known[0], notice.reason ?? PARTNER_REMOVED)
      return { known: true, checked: 1, disconnected: marked ? 1 : 0 }
    }

    if (!known.length) {
      this.logger.error(
        `account_update ${event}: la WABA ${wabaId} no está en la base. Se verifican todos los números conectados.`,
      )
    }
    const targets = known.length ? known : await this.findMonitored({ disconnectedAt: null })
    const disconnected = await this.checkWabas(targets, notice.reason)
    return { known: known.length > 0, checked: targets.length, disconnected }
  }

  /** Periodic safety net for drops whose webhook never reached us. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkAllConnected(): Promise<number> {
    if (this.config.get<string>('WHATSAPP_CONNECTION_CHECK_ENABLED') === 'false') return 0
    if (this.running) return 0
    this.running = true
    try {
      return await this.checkWabas(await this.findMonitored({ disconnectedAt: null }))
    } catch (error) {
      this.logger.error(`Chequeo de conexión de WhatsApp falló: ${(error as Error).message}`)
      return 0
    } finally {
      this.running = false
    }
  }

  /** Probes every number of each WABA; marks the WABA on the first definitive drop. */
  private async checkWabas(wabas: MonitoredWaba[], reasonHint?: string): Promise<number> {
    let marked = 0
    for (const waba of wabas) {
      try {
        const token = decryptSecret(waba.accessToken, this.encryptionKey())
        for (const phone of waba.phoneNumbers) {
          const probe = await this.probe(phone.phoneNumberId, token)
          if (probe.state !== 'disconnected') continue
          const reason = reasonHint ?? probe.reason
          if (await this.markDisconnected(waba, reason, probe.displayPhoneNumber ?? phone.number)) marked += 1
          break
        }
      } catch (error) {
        this.logger.error(`No se pudo verificar la WABA ${waba.wabaId}: ${(error as Error).message}`)
      }
    }
    return marked
  }

  /** Asks Graph whether the number is still on Cloud API with our token. */
  private async probe(phoneNumberId: string, token: string): Promise<ProbeResult> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ display_phone_number?: string; platform_type?: string; status?: string }>(
          `${this.graphBase}/${phoneNumberId}`,
          {
            params: { fields: 'id,display_phone_number,platform_type,status' },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15_000,
          },
        ),
      )
      const displayPhoneNumber = data?.display_phone_number ?? null
      if (data?.platform_type && data.platform_type !== 'CLOUD_API') {
        return { state: 'disconnected', reason: `PLATFORM_${data.platform_type}`, displayPhoneNumber }
      }
      if (data?.status && OFFLINE_STATUSES.has(data.status)) {
        return { state: 'disconnected', reason: `STATUS_${data.status}`, displayPhoneNumber }
      }
      return { state: 'connected', displayPhoneNumber }
    } catch (error) {
      const lost = connectionLostCode(error)
      if (lost) return { state: 'disconnected', reason: lost, displayPhoneNumber: null }
      this.logger.warn(`Graph no respondió por ${phoneNumberId} (${describeGraphError(error)}); se reintenta luego`)
      return { state: 'unknown' }
    }
  }

  /** Stamps the WABA once and alerts. Returns false when it was already marked. */
  private async markDisconnected(waba: MonitoredWaba, reason: string, displayNumber?: string): Promise<boolean> {
    const { count } = await this.prisma.wabaAccount.updateMany({
      where: { id: waba.id, disconnectedAt: null },
      data: { disconnectedAt: new Date(), disconnectReason: reason.slice(0, 64) },
    })
    if (count === 0) return false

    const number = displayNumber ?? waba.phoneNumbers[0]?.number ?? waba.wabaId
    this.logger.error(`🚨 WhatsApp desconectado: ${number} (WABA ${waba.wabaId}) · motivo ${reason}`)
    const copy = buildDisconnectionCopy({ producerName: waba.producer.name, number, reason, at: new Date() })
    await this.mail.sendAlert({ to: this.alertRecipients, ...copy })
    return true
  }

  private findMonitored(where: { wabaId: string } | { disconnectedAt: null }): Promise<MonitoredWaba[]> {
    return this.prisma.wabaAccount.findMany({
      where: { ...where, phoneNumbers: { some: { isActive: true, deletedAt: null } } },
      select: {
        id: true,
        wabaId: true,
        accessToken: true,
        disconnectedAt: true,
        producer: { select: { name: true } },
        phoneNumbers: {
          where: { isActive: true, deletedAt: null },
          select: { phoneNumberId: true, number: true },
        },
      },
    })
  }

  private encryptionKey() {
    return resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY')
  }
}

/** Plain-language reading of Meta's disconnection reasons (and our own Graph probes). */
export function describeDisconnectReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'BUSINESS_DOWNGRADE':
      return 'el número se registró en la app común de WhatsApp en lugar de WhatsApp Business'
    case 'PRIMARY_INACTIVITY':
      return 'nadie abrió WhatsApp Business en el celular durante unos 14 días'
    case 'COMPANION_INACTIVITY':
      return 'un dispositivo vinculado estuvo inactivo unos 30 días'
    case 'CHANGE_NUMBER':
      return 'se cambió el número de la cuenta de WhatsApp Business'
    case 'USER_RE_REGISTERED':
      return 'WhatsApp Business se volvió a registrar en otro celular'
    case 'ACCOUNT_DISCONNECTED':
      return 'la cuenta de WhatsApp se eliminó o fue suspendida'
    case 'PARTNER_REMOVED':
      return 'la empresa desconectó la plataforma desde WhatsApp Business'
    default:
      return 'Meta ya no reconoce el número o la app perdió el permiso para usarlo'
  }
}

const dateTimeFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** The alert in the office's words. Exported for tests and copy review. */
export function buildDisconnectionCopy(params: { producerName: string; number: string; reason: string; at: Date }) {
  const subject = `⚠️ WhatsApp desconectado — ${params.producerName} (${params.number})`
  const text =
    `El número ${params.number} de ${params.producerName} se desconectó de la API de WhatsApp ` +
    `(${dateTimeFmt.format(params.at)}). Motivo: ${describeDisconnectReason(params.reason)} [${params.reason}]. ` +
    'Mientras siga así el bot no recibe ni responde mensajes y lo que se envíe desde el panel no llega: ' +
    'los clientes que escriban solo aparecen en la app de WhatsApp Business del celular. ' +
    'Para volver a conectarlo, con el celular a mano, entrá al panel → Números → Reconectar y escaneá el código QR ' +
    'desde WhatsApp Business. No uses "Conectar" ni "Añadir número" en el Administrador de WhatsApp de Meta: ' +
    'eso saca el número de la app del celular.'
  return { subject, text }
}
