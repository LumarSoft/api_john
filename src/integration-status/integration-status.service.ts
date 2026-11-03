import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isAxiosError } from 'axios'
import { IntegrationBlame, IntegrationFailureKind, Role } from 'generated/prisma/client'
import type { ScopeUser } from '../common/scope/scope.service'
import { PrismaService } from '../prisma/prisma.service'
import { COMPONENT_CONTEXT, INTEGRATION_COMPONENTS, type IntegrationComponentKey } from './integration-components'
import { IncidentExplainerService, type IncidentContext } from './incident-explainer.service'

export interface IntegrationFailure {
  kind: IntegrationFailureKind
  message: string
  httpStatus?: number | null
  /** The answer behind it. Never the request: it can carry a password. */
  sample?: string | null
}

export type IntegrationState = 'operational' | 'failing' | 'unknown'

export interface IncidentView {
  id: number
  key: string
  kind: IntegrationFailureKind
  httpStatus: number | null
  message: string
  /** What the service's error page says, in its own words; null when it answered no page. */
  answer: string | null
  /** The raw answer, for the OWNER only. */
  sample?: string | null
  failures: number
  startedAt: Date
  lastFailureAt: Date
  endedAt: Date | null
  /** What the AI model says is failing and whose fault it is; null until it answers. */
  explanation: { text: string; blame: IntegrationBlame; blameReason: string; at: Date } | null
}

export interface ComponentView {
  key: IntegrationComponentKey
  status: IntegrationState
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  incident: IncidentView | null
}

export interface TriunfoAccessView {
  producerId: number
  producerName: string
  /** Whether the organization quotes and syncs with Triunfo at all. */
  configured: boolean
  failingSince: Date | null
  failureMessage: string | null
}

export interface WhatsappNumberView {
  id: number
  number: string
  producerName: string
  status: Exclude<IntegrationState, 'unknown'>
  disconnectedAt: Date | null
  disconnectReason: string | null
  tokenExpiresAt: Date | null
}

export interface StatusOverview {
  checkedAt: Date
  components: ComponentView[]
  /** The user's organization; for the OWNER, the organizations whose credentials Triunfo refuses. */
  triunfoAccess: TriunfoAccessView[]
  whatsapp: WhatsappNumberView[]
  /** Latest incidents of the last HISTORY_DAYS days, open ones included. */
  incidents: IncidentView[]
}

interface KnownComponent {
  id: number
  openIncidentId: number | null
  // When lastSuccessAt was last written, so a busy service is not written on every call.
  successWrittenAt: number
}

const MESSAGE_MAX = 500
const SAMPLE_MAX = 2000
const ANSWER_MAX = 240
const EXCERPT_MAX = 600
const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 30
const HISTORY_LIMIT = 20

const incidentSelect = {
  id: true,
  kind: true,
  httpStatus: true,
  message: true,
  sample: true,
  failures: true,
  startedAt: true,
  lastFailureAt: true,
  endedAt: true,
  aiExplanation: true,
  aiBlame: true,
  aiBlameReason: true,
  aiExplainedAt: true,
  aiExplainedFor: true,
  component: { select: { key: true } },
} as const

/**
 * How the external services the platform depends on are answering, for the
 * panel's Status section: on 3/11/2026 Triunfo's RESTDocumentosV2 started
 * answering 404 ("la página no existe o ha sido movida") and the office had
 * no way to show its clients that the problem was Triunfo's.
 *
 * Callers report each call: `succeeded` or `failed`. A failure opens an
 * incident (or adds to the open one) and the next success ends it. Only
 * failures of the service itself count: a request Triunfo or InfoAuto refuses
 * on its merits (a policy not found, a model that does not exist) is an
 * answer, so it counts as a success.
 *
 * Each incident is handed to the AI model once (and again only if it starts
 * failing differently), to say in plain words what is failing and whose fault
 * it is; the panel shows that to the SuperAdmin.
 *
 * The API runs as a single process, so what each component looks like is kept
 * in memory and calls to one component are serialized. Nothing here ever
 * throws: reporting a call must not change what the caller sees.
 */
@Injectable()
export class IntegrationStatusService {
  private readonly logger = new Logger(IntegrationStatusService.name)
  // lastSuccessAt is written at most this often while nothing fails.
  private static readonly SUCCESS_WRITE_EVERY_MS = 60 * 1000
  // A failure this soon after an incident ended reopens it: an intermittent
  // service is one incident, not dozens.
  private static readonly REOPEN_WITHIN_MS = 15 * 60 * 1000
  // A failed explanation is asked again after this long.
  private static readonly EXPLAIN_RETRY_MS = 10 * 60 * 1000
  private readonly known = new Map<IntegrationComponentKey, KnownComponent>()
  private readonly queues = new Map<IntegrationComponentKey, Promise<void>>()
  // "incidentId|signature" → when it was last handed to the model.
  private readonly explainTriedAt = new Map<string, number>()
  private readonly defaultProducerSlug: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly explainer: IncidentExplainerService,
    config: ConfigService,
  ) {
    this.defaultProducerSlug = config.get<string>('DEFAULT_PRODUCER_SLUG') ?? 'john'
  }

  /** The service answered: ends its open incident. */
  succeeded(key: IntegrationComponentKey): Promise<void> {
    return this.serialize(key, async () => {
      const component = await this.component(key)
      const now = Date.now()
      if (
        component.openIncidentId === null &&
        now - component.successWrittenAt < IntegrationStatusService.SUCCESS_WRITE_EVERY_MS
      ) {
        return
      }
      const at = new Date(now)
      if (component.openIncidentId !== null) {
        await this.prisma.$transaction([
          this.prisma.integrationIncident.update({ where: { id: component.openIncidentId }, data: { endedAt: at } }),
          this.prisma.integrationComponent.update({
            where: { id: component.id },
            data: { lastSuccessAt: at, openIncidentId: null },
          }),
        ])
        this.logger.log(`${key} volvió a responder`)
      } else {
        await this.prisma.integrationComponent.update({ where: { id: component.id }, data: { lastSuccessAt: at } })
      }
      component.openIncidentId = null
      component.successWrittenAt = now
    })
  }

  /** The service failed: opens an incident, or adds this failure to the open one. */
  failed(key: IntegrationComponentKey, failure: IntegrationFailure): Promise<void> {
    return this.serialize(key, async () => {
      const component = await this.component(key)
      const at = new Date()
      const detail = {
        kind: failure.kind,
        httpStatus: failure.httpStatus ?? null,
        message: failure.message.slice(0, MESSAGE_MAX),
        ...(failure.sample ? { sample: failure.sample.slice(0, SAMPLE_MAX) } : {}),
        lastFailureAt: at,
      }

      if (component.openIncidentId !== null) {
        await this.prisma.$transaction([
          this.prisma.integrationIncident.update({
            where: { id: component.openIncidentId },
            data: { ...detail, failures: { increment: 1 } },
          }),
          this.prisma.integrationComponent.update({ where: { id: component.id }, data: { lastFailureAt: at } }),
        ])
        this.requestExplanation(component.openIncidentId, signatureOf(failure))
        return
      }

      const recent = await this.prisma.integrationIncident.findFirst({
        where: {
          componentId: component.id,
          deletedAt: null,
          endedAt: { gte: new Date(at.getTime() - IntegrationStatusService.REOPEN_WITHIN_MS) },
        },
        orderBy: { endedAt: 'desc' },
        select: { id: true },
      })
      const incidentId = recent
        ? (
            await this.prisma.integrationIncident.update({
              where: { id: recent.id },
              data: { ...detail, endedAt: null, failures: { increment: 1 } },
              select: { id: true },
            })
          ).id
        : (
            await this.prisma.integrationIncident.create({
              data: { ...detail, componentId: component.id, startedAt: at },
              select: { id: true },
            })
          ).id
      await this.prisma.integrationComponent.update({
        where: { id: component.id },
        data: { openIncidentId: incidentId, lastFailureAt: at },
      })
      component.openIncidentId = incidentId
      if (!recent) this.logger.warn(`${key} empezó a fallar: ${failure.message}`)
      this.requestExplanation(incidentId, signatureOf(failure))
    })
  }

  /** Everything the Status section shows to this user. */
  async overview(user: ScopeUser): Promise<StatusOverview> {
    const isOwner = user.role === Role.OWNER
    const rows = await this.prisma.integrationComponent.findMany({
      where: { deletedAt: null },
      select: { key: true, lastSuccessAt: true, lastFailureAt: true, openIncidentId: true },
    })
    const openIds = rows.map(r => r.openIncidentId).filter((id): id is number => id !== null)
    const [open, history, triunfoAccess, whatsapp] = await Promise.all([
      this.prisma.integrationIncident.findMany({ where: { id: { in: openIds } }, select: incidentSelect }),
      this.prisma.integrationIncident.findMany({
        where: {
          deletedAt: null,
          OR: [{ endedAt: null }, { startedAt: { gte: new Date(Date.now() - HISTORY_DAYS * DAY_MS) } }],
        },
        orderBy: { startedAt: 'desc' },
        take: HISTORY_LIMIT,
        select: incidentSelect,
      }),
      this.triunfoAccess(user, isOwner),
      this.whatsappNumbers(user, isOwner),
    ])

    // An incident the model has not explained yet (it failed, or it was busy) is asked again.
    for (const incident of open) {
      if (incident.aiExplainedFor !== signatureOf(incident)) this.requestExplanation(incident.id, signatureOf(incident))
    }

    const byKey = new Map(rows.map(r => [r.key, r]))
    const openById = new Map(open.map(i => [i.id, i]))
    return {
      checkedAt: new Date(),
      components: INTEGRATION_COMPONENTS.map(key => {
        const row = byKey.get(key)
        const incident = row?.openIncidentId != null ? openById.get(row.openIncidentId) : undefined
        return {
          key,
          status: incident ? 'failing' : row?.lastSuccessAt ? 'operational' : 'unknown',
          lastSuccessAt: row?.lastSuccessAt ?? null,
          lastFailureAt: row?.lastFailureAt ?? null,
          incident: incident ? presentIncident(incident, isOwner) : null,
        }
      }),
      triunfoAccess,
      whatsapp,
      incidents: history.map(i => presentIncident(i, isOwner)),
    }
  }

  /** The organization's own Triunfo user; for the OWNER, every organization Triunfo is refusing. */
  private async triunfoAccess(user: ScopeUser, isOwner: boolean): Promise<TriunfoAccessView[]> {
    if (isOwner) {
      const failing = await this.prisma.triunfoAuthStatus.findMany({
        where: { deletedAt: null, failingSince: { not: null } },
        orderBy: { failingSince: 'asc' },
        select: { failingSince: true, failureMessage: true, producer: { select: { id: true, name: true } } },
      })
      return failing.map(s => ({
        producerId: s.producer.id,
        producerName: s.producer.name,
        configured: true,
        failingSince: s.failingSince,
        failureMessage: s.failureMessage,
      }))
    }

    const producer = await this.prisma.producer.findFirst({
      where: { id: user.producerId },
      select: {
        id: true,
        name: true,
        slug: true,
        triunfoCredential: { select: { deletedAt: true } },
        triunfoAuthStatus: { select: { failingSince: true, failureMessage: true, deletedAt: true } },
      },
    })
    if (!producer) return []
    const status = producer.triunfoAuthStatus?.deletedAt === null ? producer.triunfoAuthStatus : null
    return [
      {
        producerId: producer.id,
        producerName: producer.name,
        // Its own credentials, or the default organization's TRIUNFO_* settings.
        configured: producer.triunfoCredential?.deletedAt === null || producer.slug === this.defaultProducerSlug,
        failingSince: status?.failingSince ?? null,
        failureMessage: status?.failureMessage ?? null,
      },
    ]
  }

  /** The organization's numbers (every organization's, for the OWNER) and whether Meta still delivers on each one. */
  private async whatsappNumbers(user: ScopeUser, isOwner: boolean): Promise<WhatsappNumberView[]> {
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { deletedAt: null, isActive: true, ...(isOwner ? {} : { producerId: user.producerId }) },
      orderBy: [{ producerId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        number: true,
        producer: { select: { name: true } },
        wabaAccount: { select: { disconnectedAt: true, disconnectReason: true, tokenExpiresAt: true } },
      },
    })
    const now = Date.now()
    return numbers.map(n => {
      const waba = n.wabaAccount
      const expired = waba?.tokenExpiresAt != null && waba.tokenExpiresAt.getTime() <= now
      return {
        id: n.id,
        number: n.number,
        producerName: n.producer.name,
        status: waba?.disconnectedAt || expired ? 'failing' : 'operational',
        disconnectedAt: waba?.disconnectedAt ?? null,
        disconnectReason: waba?.disconnectReason ?? null,
        tokenExpiresAt: waba?.tokenExpiresAt ?? null,
      }
    })
  }

  /** Hands the incident to the AI model, unless this same failure was just tried. Never awaited. */
  private requestExplanation(incidentId: number, signature: string): void {
    if (!this.explainer.enabled) return
    const attempt = `${incidentId}|${signature}`
    const triedAt = this.explainTriedAt.get(attempt)
    if (triedAt !== undefined && Date.now() - triedAt < IntegrationStatusService.EXPLAIN_RETRY_MS) return
    this.explainTriedAt.set(attempt, Date.now())
    void this.explainIncident(incidentId, signature)
  }

  private async explainIncident(incidentId: number, signature: string): Promise<void> {
    try {
      const incident = await this.prisma.integrationIncident.findFirst({
        where: { id: incidentId, deletedAt: null },
        select: { ...incidentSelect, component: { select: { key: true, lastSuccessAt: true } } },
      })
      if (!incident || incident.aiExplainedFor === signature) return
      const key = incident.component.key as IntegrationComponentKey
      const explanation = await this.explainer.explain(await this.incidentContext(key, incident))
      await this.prisma.integrationIncident.update({
        where: { id: incidentId },
        data: {
          aiExplanation: explanation.explanation,
          aiBlame: explanation.blame,
          aiBlameReason: explanation.blameReason,
          aiExplainedAt: new Date(),
          aiExplainedFor: signature,
        },
      })
    } catch (err) {
      this.logger.warn(
        `No se pudo explicar el incidente ${incidentId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** The failure, plus how the provider's other services are doing: whether its server is up at all. */
  private async incidentContext(
    key: IntegrationComponentKey,
    incident: {
      kind: IntegrationFailureKind
      httpStatus: number | null
      message: string
      sample: string | null
      failures: number
      startedAt: Date
      component: { lastSuccessAt: Date | null }
    },
  ): Promise<IncidentContext> {
    const prefix = `${key.split('.')[0]}.`
    const siblings = await this.prisma.integrationComponent.findMany({
      where: { deletedAt: null, key: { startsWith: prefix, not: key } },
      select: { key: true, lastSuccessAt: true, openIncidentId: true },
    })
    const openIds = siblings.map(s => s.openIncidentId).filter((id): id is number => id !== null)
    const open = await this.prisma.integrationIncident.findMany({
      where: { id: { in: openIds } },
      select: { id: true, kind: true, httpStatus: true },
    })
    const openById = new Map(open.map(i => [i.id, i]))
    const context = COMPONENT_CONTEXT[key]
    return {
      ...context,
      failure: {
        kind: incident.kind,
        httpStatus: incident.httpStatus,
        message: incident.message,
        answer: pageText(incident.sample) ?? maskedExcerpt(incident.sample),
        startedAt: incident.startedAt,
        failures: incident.failures,
        lastSuccessAt: incident.component.lastSuccessAt,
      },
      otherServices: siblings
        .filter((s): s is typeof s & { key: IntegrationComponentKey } => s.key in COMPONENT_CONTEXT)
        .map(s => {
          const failing = s.openIncidentId !== null ? openById.get(s.openIncidentId) : undefined
          return {
            service: COMPONENT_CONTEXT[s.key].service,
            state: failing ? 'falla' : s.lastSuccessAt ? 'funciona' : 'sin datos',
            lastSuccessAt: s.lastSuccessAt,
            failure: failing ? { kind: failing.kind, httpStatus: failing.httpStatus } : null,
          }
        }),
    }
  }

  /** The component's row, created the first time and then kept in memory. */
  private async component(key: IntegrationComponentKey): Promise<KnownComponent> {
    const cached = this.known.get(key)
    if (cached) return cached
    const row = await this.prisma.integrationComponent.upsert({
      where: { key },
      create: { key },
      update: {},
      select: { id: true, openIncidentId: true },
    })
    const component = { id: row.id, openIncidentId: row.openIncidentId, successWrittenAt: 0 }
    this.known.set(key, component)
    return component
  }

  /** Runs reports of one component one after the other; a failed one is logged and dropped. */
  private serialize(key: IntegrationComponentKey, task: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(task).catch((err: unknown) => {
      // What is in memory may no longer match the table: read it again next time.
      this.known.delete(key)
      this.logger.warn(`No se pudo registrar el estado de ${key}: ${err instanceof Error ? err.message : String(err)}`)
    })
    this.queues.set(key, run)
    return run
  }
}

/** Kind, status and message of a call that threw: an HTTP status, a timeout, no connection. */
export function describeFailure(err: unknown): IntegrationFailure {
  if (isAxiosError(err)) {
    if (err.response) {
      const { status, statusText, data } = err.response
      return {
        kind: IntegrationFailureKind.HTTP_ERROR,
        httpStatus: status,
        message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
        sample: typeof data === 'string' ? data : data == null ? null : JSON.stringify(data),
      }
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return { kind: IntegrationFailureKind.TIMEOUT, message: err.message }
    }
    return { kind: IntegrationFailureKind.NETWORK, message: err.code ? `${err.code}: ${err.message}` : err.message }
  }
  return { kind: IntegrationFailureKind.UNEXPECTED_RESPONSE, message: err instanceof Error ? err.message : String(err) }
}

/** Which failure an explanation is about: the same kind and status is the same failure. */
export function signatureOf(failure: { kind: IntegrationFailureKind; httpStatus?: number | null }): string {
  return `${failure.kind}:${failure.httpStatus ?? ''}`
}

/** The start of an answer that is not a page, with long numbers (policies, documents) blanked. */
function maskedExcerpt(sample: string | null): string | null {
  if (!sample) return null
  return sample.slice(0, EXCERPT_MAX).replace(/\d{4,}/g, '#')
}

/**
 * The visible text of an error page, e.g. Triunfo's 404 of 3/11/2026: "ERROR 404
 * PÁGINA NO ENCONTRADA La página que intenta visitar no existe o ha sido movida."
 * Null for anything that is not a page (JSON, a PDF's first bytes).
 */
export function pageText(sample: string | null): string | null {
  if (!sample || !/<(!doctype|html|head|body|title)\b/i.test(sample)) return null
  const text = decodeEntities(
    sample
      // The sample is cut short: a style or script may never close.
      .replace(/<(style|script)\b[\s\S]*?(<\/\1>|$)/gi, ' ')
      .replace(/<[^>]*>?/g, ' '),
  )
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, ANSWER_MAX) : null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return NAMED_ENTITIES[name] ?? ' '
  })
}

function presentIncident(
  incident: {
    id: number
    kind: IntegrationFailureKind
    httpStatus: number | null
    message: string
    sample: string | null
    failures: number
    startedAt: Date
    lastFailureAt: Date
    endedAt: Date | null
    aiExplanation: string | null
    aiBlame: IntegrationBlame | null
    aiBlameReason: string | null
    aiExplainedAt: Date | null
    aiExplainedFor: string | null
    component: { key: string }
  },
  isOwner: boolean,
): IncidentView {
  // An explanation of a different failure (it started failing otherwise since) is not shown.
  const explained =
    incident.aiExplanation &&
    incident.aiBlame &&
    incident.aiExplainedAt &&
    incident.aiExplainedFor === signatureOf(incident)
  return {
    id: incident.id,
    key: incident.component.key,
    kind: incident.kind,
    httpStatus: incident.httpStatus,
    message: incident.message,
    answer: pageText(incident.sample),
    ...(isOwner ? { sample: incident.sample } : {}),
    failures: incident.failures,
    startedAt: incident.startedAt,
    lastFailureAt: incident.lastFailureAt,
    endedAt: incident.endedAt,
    explanation: explained
      ? {
          text: incident.aiExplanation as string,
          blame: incident.aiBlame as IntegrationBlame,
          blameReason: incident.aiBlameReason ?? '',
          at: incident.aiExplainedAt as Date,
        }
      : null,
  }
}
