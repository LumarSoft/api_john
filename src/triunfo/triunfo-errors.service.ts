import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isAxiosError } from 'axios'
import { TriunfoErrorKind } from 'generated/prisma/client'
import { IntegrationStatusService } from '../integration-status/integration-status.service'
import { MailService } from '../mail/mail.service'
import { MatterCategory, MatterStatus, NovedadType } from '../novedades/dto/list-novedades.dto'
import { PrismaService } from '../prisma/prisma.service'
import { credentialsRecoveredCopy, credentialsRejectedCopy, newErrorCopy, type AlertCopy } from './triunfo-alerts'

export type TriunfoOperation =
  | 'getTokenRest'
  | 'RESTNovedadesCartera'
  | 'RESTDocumentosV2'
  | 'documentDownload'
  | 'RESTCotizadorAutV2'

export interface TriunfoFailure {
  operation: TriunfoOperation
  /** Organization whose credentials made the call; null = the default organization. */
  producerId: number | null
  kind: TriunfoErrorKind
  message: string
  httpStatus?: number | null
  /** The answer behind it. Never the request: it carries the password. */
  sample?: string | null
}

export interface TriunfoAuthState {
  /** Null while Triunfo accepts the organization's credentials. */
  failingSince: Date | null
  failureMessage: string | null
}

export interface TriunfoErrorRow {
  id: number
  operation: string
  kind: TriunfoErrorKind
  httpStatus: number | null
  message: string
  sample: string | null
  occurrences: number
  firstSeenAt: Date
  lastSeenAt: Date
}

type Seen = 'new' | 'reappeared' | 'known'

const MESSAGE_MAX = 500
const SAMPLE_MAX = 2000

/**
 * Keeps a record of every failed call to Triunfo and says so when it matters.
 *
 * On 30/10/2026 the password changed in TriunfoNet and for a day getTokenRest
 * refused it: the bot could not send a policy or quote, the cartera stopped
 * syncing, and the only trace was a warning in the bot's log. So:
 *
 *   - every failure is a TriunfoError row, one per distinct failure, counted;
 *     a new one (or one back after a week) mails Lumarsoft, since it is often
 *     a change on Triunfo's side (on 29/10 they started requiring a Referer);
 *   - a refused credential opens an outage (TriunfoAuthStatus): a notice in
 *     Asuntos pendientes and a mail to the organization's SuperAdmins and to
 *     Lumarsoft, a reminder each day, and a mail when it ends.
 *
 * Recipients: the SuperAdmins (outages only), every OWNER user and
 * TRIUNFO_ALERT_EMAIL (comma-separated). Every call's outcome also reaches the
 * panel's Status section (IntegrationStatusService). Nothing here ever throws:
 * recording a failure must not change what the caller sees.
 */
@Injectable()
export class TriunfoErrorsService {
  private readonly logger = new Logger(TriunfoErrorsService.name)
  // A failure that comes back after this long without happening is announced again.
  private static readonly REAPPEARED_AFTER_MS = 7 * 24 * 60 * 60 * 1000
  // While the credentials keep failing, the reminder goes out once a day.
  private static readonly REMINDER_EVERY_MS = 24 * 60 * 60 * 1000
  private readonly extraRecipients: string[]
  private readonly defaultProducerSlug: string
  private defaultProducerId: number | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly status: IntegrationStatusService,
    config: ConfigService,
  ) {
    this.extraRecipients = (config.get<string>('TRIUNFO_ALERT_EMAIL') ?? '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean)
    this.defaultProducerSlug = config.get<string>('DEFAULT_PRODUCER_SLUG') ?? 'john'
  }

  /** Triunfo answered the operation as expected, for the Status section. */
  answered(operation: TriunfoOperation): void {
    void this.status.succeeded(`triunfo.${operation}`)
  }

  /** Records a failed call to Triunfo. */
  async record(failure: TriunfoFailure): Promise<void> {
    this.reportStatus(failure)
    try {
      const producerId = await this.resolveProducerId(failure.producerId)
      if (producerId === null) return
      const seen = await this.count(producerId, failure)
      if (failure.kind === TriunfoErrorKind.CREDENTIALS_REJECTED) {
        await this.markRejected(producerId, failure.message)
      } else if (seen !== 'known') {
        await this.announceError(producerId, failure, seen === 'reappeared')
      }
    } catch (err) {
      this.logger.warn(`No se pudo registrar un error de Triunfo (${failure.operation}): ${errorMessage(err)}`)
    }
  }

  /** Records a call that threw: an HTTP status, a timeout, no connection. */
  recordException(operation: TriunfoOperation, producerId: number | null, err: unknown): Promise<void> {
    return this.record({ operation, producerId, ...describeException(err) })
  }

  /** Triunfo accepted the organization's credentials: ends an open outage. */
  async credentialsAccepted(producerId: number | null): Promise<void> {
    try {
      const id = await this.resolveProducerId(producerId)
      if (id === null) return
      const status = await this.prisma.triunfoAuthStatus.findUnique({
        where: { producerId: id },
        select: { failingSince: true, notificationId: true },
      })
      if (!status?.failingSince) return

      // Only one caller closes it, even when several succeed at once.
      const closed = await this.prisma.triunfoAuthStatus.updateMany({
        where: { producerId: id, failingSince: status.failingSince },
        data: { failingSince: null, failureMessage: null, lastAlertAt: null, notificationId: null },
      })
      if (closed.count === 0) return

      const now = new Date()
      if (status.notificationId != null) {
        await this.prisma.notification.updateMany({
          where: { id: status.notificationId, producerId: id },
          data: { status: MatterStatus.RESOLVED, resolvedAt: now },
        })
      }
      const producerName = await this.producerName(id)
      this.logger.log(`Triunfo volvió a aceptar las credenciales de ${producerName}`)
      await this.send(
        await this.outageRecipients(id),
        credentialsRecoveredCopy({ producerName, since: status.failingSince, at: now }),
      )
    } catch (err) {
      this.logger.warn(`No se pudo cerrar la caída de credenciales de Triunfo: ${errorMessage(err)}`)
    }
  }

  async authState(producerId: number): Promise<TriunfoAuthState> {
    const status = await this.prisma.triunfoAuthStatus.findFirst({
      where: { producerId, deletedAt: null },
      select: { failingSince: true, failureMessage: true },
    })
    return { failingSince: status?.failingSince ?? null, failureMessage: status?.failureMessage ?? null }
  }

  /** The organization's failures, latest first. */
  list(producerId: number, limit = 50): Promise<TriunfoErrorRow[]> {
    return this.prisma.triunfoError.findMany({
      where: { producerId, deletedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      select: {
        id: true,
        operation: true,
        kind: true,
        httpStatus: true,
        message: true,
        sample: true,
        occurrences: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    })
  }

  /**
   * A refusal is Triunfo answering, about that request or those credentials:
   * the service works. The rest is the service failing, for every organization.
   */
  private reportStatus(failure: TriunfoFailure): void {
    if (failure.kind === TriunfoErrorKind.REJECTED || failure.kind === TriunfoErrorKind.CREDENTIALS_REJECTED) {
      this.answered(failure.operation)
      return
    }
    void this.status.failed(`triunfo.${failure.operation}`, {
      kind: failure.kind,
      httpStatus: failure.httpStatus,
      message: failure.message,
      sample: failure.sample,
    })
  }

  /** Adds the failure to its row, creating it the first time. */
  private async count(producerId: number, failure: TriunfoFailure): Promise<Seen> {
    const fingerprint = fingerprintOf(producerId, failure)
    const now = new Date()
    const sample = failure.sample ? failure.sample.slice(0, SAMPLE_MAX) : null
    const existing = await this.prisma.triunfoError.findUnique({ where: { fingerprint }, select: { lastSeenAt: true } })

    if (!existing) {
      try {
        await this.prisma.triunfoError.create({
          data: {
            producerId,
            operation: failure.operation,
            kind: failure.kind,
            httpStatus: failure.httpStatus ?? null,
            message: failure.message.slice(0, MESSAGE_MAX),
            sample,
            fingerprint,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        })
        return 'new'
      } catch (err) {
        // A concurrent call created it first: count this one on that row.
        if ((err as { code?: string }).code !== 'P2002') throw err
      }
    }

    await this.prisma.triunfoError.update({
      where: { fingerprint },
      data: { occurrences: { increment: 1 }, lastSeenAt: now, ...(sample ? { sample } : {}) },
    })
    return existing && now.getTime() - existing.lastSeenAt.getTime() > TriunfoErrorsService.REAPPEARED_AFTER_MS
      ? 'reappeared'
      : 'known'
  }

  /** Opens the outage on the first refusal; while it lasts, reminds once a day. */
  private async markRejected(producerId: number, message: string): Promise<void> {
    const now = new Date()
    const failureMessage = message.slice(0, MESSAGE_MAX)
    const statusId = await this.ensureStatus(producerId)

    // Only the first refusal opens it: a concurrent one finds it already open.
    const opened = await this.prisma.triunfoAuthStatus.updateMany({
      where: { producerId, failingSince: null },
      data: { failingSince: now, failureMessage, lastAlertAt: now },
    })
    if (opened.count === 1) {
      const producerName = await this.producerName(producerId)
      this.logger.warn(`Triunfo rechaza las credenciales de ${producerName}: ${message}`)
      const copy = credentialsRejectedCopy({ producerName, since: now, message, reminder: false })
      const notice = await this.prisma.notification.create({
        data: {
          producerId,
          category: MatterCategory.OTHER,
          type: NovedadType.TRIUNFO,
          refId: statusId,
          title: copy.subject,
          body: copy.text,
        },
        select: { id: true },
      })
      await this.prisma.triunfoAuthStatus.update({ where: { producerId }, data: { notificationId: notice.id } })
      await this.send(await this.outageRecipients(producerId), copy)
      return
    }

    const reminded = await this.prisma.triunfoAuthStatus.updateMany({
      where: {
        producerId,
        failingSince: { not: null },
        OR: [
          { lastAlertAt: null },
          { lastAlertAt: { lt: new Date(now.getTime() - TriunfoErrorsService.REMINDER_EVERY_MS) } },
        ],
      },
      data: { lastAlertAt: now, failureMessage },
    })
    if (reminded.count === 0) return
    const status = await this.prisma.triunfoAuthStatus.findUnique({
      where: { producerId },
      select: { failingSince: true },
    })
    if (!status?.failingSince) return
    const producerName = await this.producerName(producerId)
    await this.send(
      await this.outageRecipients(producerId),
      credentialsRejectedCopy({ producerName, since: status.failingSince, message, reminder: true, now }),
    )
  }

  private async announceError(producerId: number, failure: TriunfoFailure, reappeared: boolean): Promise<void> {
    const copy = newErrorCopy({
      producerName: await this.producerName(producerId),
      operation: failure.operation,
      kind: failure.kind,
      httpStatus: failure.httpStatus ?? null,
      message: failure.message,
      reappeared,
    })
    this.logger.warn(copy.subject)
    await this.send(await this.ownerRecipients(), copy)
  }

  /** The organization's status row, created the first time; returns its id. */
  private async ensureStatus(producerId: number): Promise<number> {
    try {
      const row = await this.prisma.triunfoAuthStatus.upsert({
        where: { producerId },
        create: { producerId },
        update: {},
        select: { id: true },
      })
      return row.id
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err
      const row = await this.prisma.triunfoAuthStatus.findUniqueOrThrow({ where: { producerId }, select: { id: true } })
      return row.id
    }
  }

  private async send(to: string[], copy: AlertCopy): Promise<void> {
    if (to.length === 0) {
      this.logger.warn(`Sin destinatarios para el aviso de Triunfo — ${copy.subject}. ${copy.text}`)
      return
    }
    await this.mail.sendAlert({ to, subject: copy.subject, text: copy.text })
  }

  /** Lumarsoft: every OWNER user plus TRIUNFO_ALERT_EMAIL. */
  private async ownerRecipients(): Promise<string[]> {
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', deletedAt: null },
      select: { email: true },
    })
    return unique([...owners.map(u => u.email), ...this.extraRecipients])
  }

  /** An outage also reaches the organization's SuperAdmins. */
  private async outageRecipients(producerId: number): Promise<string[]> {
    const superAdmins = await this.prisma.user.findMany({
      where: { producerId, role: 'SUPERADMIN', deletedAt: null },
      select: { email: true },
    })
    return unique([...superAdmins.map(u => u.email), ...(await this.ownerRecipients())])
  }

  private async producerName(producerId: number): Promise<string> {
    const producer = await this.prisma.producer.findFirst({ where: { id: producerId }, select: { name: true } })
    return producer?.name ?? `la organización ${producerId}`
  }

  /** Null means the default organization (DEFAULT_PRODUCER_SLUG), whose id is looked up once. */
  private async resolveProducerId(producerId: number | null): Promise<number | null> {
    if (producerId !== null) return producerId
    if (this.defaultProducerId === null) {
      const producer = await this.prisma.producer.findFirst({
        where: { slug: this.defaultProducerSlug, deletedAt: null },
        select: { id: true },
      })
      this.defaultProducerId = producer?.id ?? null
    }
    return this.defaultProducerId
  }
}

/** Kind, status and message of a call that threw. */
export function describeException(err: unknown): Pick<TriunfoFailure, 'kind' | 'message' | 'httpStatus' | 'sample'> {
  if (isAxiosError(err)) {
    if (err.response) {
      const { status, statusText, data } = err.response
      return {
        kind: TriunfoErrorKind.HTTP_ERROR,
        httpStatus: status,
        message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
        sample: bodySample(data),
      }
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return { kind: TriunfoErrorKind.TIMEOUT, message: err.message }
    }
    return { kind: TriunfoErrorKind.NETWORK, message: err.code ? `${err.code}: ${err.message}` : err.message }
  }
  return { kind: TriunfoErrorKind.UNEXPECTED_RESPONSE, message: errorMessage(err) }
}

/** A response body as text, cut short: HTML, JSON or the start of a binary file. */
export function bodySample(data: unknown): string | null {
  if (data == null) return null
  let text: string
  if (typeof data === 'string') text = data
  else if (Buffer.isBuffer(data)) text = bufferText(data)
  else if (data instanceof ArrayBuffer) text = bufferText(Buffer.from(data))
  else text = JSON.stringify(data)
  return text.slice(0, SAMPLE_MAX)
}

/**
 * An HTML or XML page is UTF-8 text (Triunfo's 404 page says «PÁGINA NO
 * ENCONTRADA»); anything else, like the start of a PDF, is read byte by byte.
 */
function bufferText(buffer: Buffer): string {
  return /^\s*</.test(buffer.subarray(0, 64).toString('latin1')) ? buffer.toString('utf8') : buffer.toString('latin1')
}

/**
 * Identity of a failure: the same organization, operation, kind, status and
 * message. Numbers are blanked so "póliza 123" and "póliza 456" are one row.
 */
export function fingerprintOf(
  producerId: number,
  failure: Pick<TriunfoFailure, 'operation' | 'kind' | 'httpStatus' | 'message'>,
): string {
  const message = failure.message.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300)
  return createHash('sha256')
    .update([producerId, failure.operation, failure.kind, failure.httpStatus ?? '', message].join('|'))
    .digest('hex')
}

function unique(emails: string[]): string[] {
  return [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
