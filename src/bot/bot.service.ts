import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { inForcePolizaWhere } from '../common/poliza-vigencia'
import { isSamePhone } from '../common/phone-match'
import { TriunfoService } from '../triunfo/triunfo.service'
import { MailService } from '../mail/mail.service'
import { NovedadesService } from '../novedades/novedades.service'
import { UsageService } from '../usage/usage.service'
import { SaveMessageDto } from './dto/save-message.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { AgentEchoDto } from './dto/agent-echo.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'
import {
  AUDIOS_PUBLIC_PREFIX,
  AdjuntoMeta,
  MAX_FILES,
  toAdjuntoMeta,
  toStoredAdjuntos,
} from '../siniestros/siniestro-upload.config'
import { type ActiveClosure, computeStatus, formatSchedule, parseSchedule } from '../business-hours/schedule'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'

// Inactivity window after which a chat is considered finished (see getOrCreateConversation).
const DEFAULT_SESSION_TIMEOUT_MINUTES = 5
// The goodbye only goes out for a silence that crossed the timeout this
// recently. The sweep runs every minute, so anything older was not being
// swept — the bot was switched off, paused or down — and is closed silently.
const WARNING_WINDOW_MS = 10 * 60_000
// How far back the bot is told that a person from the office wrote to this
// chat. A session lasts minutes, so a customer who answers that person a few
// hours later starts a fresh session the bot would otherwise greet from zero.
const HUMAN_REPLY_LOOKBACK_MS = 24 * 60 * 60_000
// A photo sent outside the guided claim steps only joins an open claim filed
// this recently; an older claim is not where an unrelated photo belongs.
const LOOSE_PHOTO_CLAIM_WINDOW_MS = 48 * 60 * 60_000

const toDateStr = (d: Date): string => d.toISOString().slice(0, 10)

interface ClientLink {
  waId: string
  sessionStartedAt: Date | null
  clientLinkedAt: Date | null
  client: { phone: string | null } | null
}

/**
 * Whether the conversation's linked client still applies to whoever is writing.
 * A WhatsApp number is a person, not a client: a relative or a broker often
 * writes with someone else's DNI. That link is honoured only for the session
 * in which it was made; otherwise the next visit greeted the writer by the
 * other person's name and served that person's policies without asking. A
 * client whose stored phone is this very number stays linked across sessions.
 */
function isClientLinkActive(link: ClientLink): boolean {
  if (!link.client) return false
  if (isSamePhone(link.waId, link.client.phone)) return true
  if (!link.clientLinkedAt) return false
  return !link.sessionStartedAt || link.clientLinkedAt >= link.sessionStartedAt
}

const CLIENT_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  dni: true,
  email: true,
  phone: true,
  city: true,
} as const

const POLIZA_SUMMARY_SELECT = {
  id: true,
  certificado: true,
  company: true,
  riskType: true,
  status: true,
  vigenciaDesde: true,
  vigenciaHasta: true,
  paymentMethod: true,
  vehiculo: {
    select: {
      dominio: true,
      marca: true,
      modelo: true,
      anio: true,
      cobertura: true,
    },
  },
} as const

@Injectable()
export class BotService {
  private readonly sessionTimeoutMs: number
  private readonly wabaTokenEncryptionKey: string | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly mail: MailService,
    private readonly novedades: NovedadesService,
    private readonly usage: UsageService,
    config: ConfigService,
  ) {
    const minutes = Number(config.get<string>('SESSION_TIMEOUT_MINUTES'))
    const valid = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SESSION_TIMEOUT_MINUTES
    this.sessionTimeoutMs = valid * 60_000
    this.wabaTokenEncryptionKey = config.get<string>('WABA_TOKEN_ENCRYPTION_KEY')
  }

  /** Resolves the producer (tenant) behind a Meta phone number ID. */
  async getContext(phoneNumberId: string) {
    const phoneNumber = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId, isActive: true, deletedAt: null },
      select: {
        producer: {
          select: {
            id: true,
            name: true,
            slug: true,
            botName: true,
            botEnabled: true,
            businessHours: true,
            systemPrompt: true,
            isActive: true,
          },
        },
      },
    })
    if (!phoneNumber || !phoneNumber.producer.isActive) {
      throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    }

    const { id, name, slug, botName, botEnabled, businessHours, systemPrompt } = phoneNumber.producer
    // The bot shows the formatted week as its general "horario" line; richer
    // open-now info comes from GET /public/hours when a user asks.
    const attentionHours = formatSchedule(parseSchedule(businessHours))
    // When the number is over its monthly budget, the bot disables the paid LLM
    // (deterministic flows keep working at zero token cost).
    const llmEnabled = await this.usage.isLlmEnabled(phoneNumberId)
    return {
      producerId: id,
      producerName: name,
      producerSlug: slug,
      botName,
      botEnabled,
      attentionHours,
      systemPrompt,
      llmEnabled,
    }
  }

  /**
   * Resolves the customer-scoped business token for a Meta number. Legacy test
   * numbers have no WABA relation and deliberately return null so the bot can
   * keep using its temporary WHATSAPP_TOKEN fallback during the transition.
   */
  async getAccessToken(phoneNumberId: string) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId, isActive: true, deletedAt: null },
      select: {
        wabaAccount: {
          select: { accessToken: true, disconnectedAt: true },
        },
      },
    })

    if (!phone) throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    if (!phone.wabaAccount || phone.wabaAccount.disconnectedAt) return { accessToken: null }

    const key = resolveKey(this.wabaTokenEncryptionKey, 'WABA_TOKEN_ENCRYPTION_KEY')
    return { accessToken: decryptSecret(phone.wabaAccount.accessToken, key) }
  }

  /**
   * Records a message an employee sent from the WhatsApp Business app and
   * PAUSES THE BOT in that conversation.
   *
   * This is the whole point of wiring up Coexistence echoes: without it the bot
   * and the office staff answer the same customer at the same time, in front of
   * the customer. The pause reuses the same `botPaused` flag as the manual
   * takeover from the inbox, so releasing works exactly as it already does.
   *
   * The message is stored with role "assistant" rather than a new "agent" role:
   * from the transcript's point of view it is the business speaking, and it
   * keeps the LLM history mapping valid if the conversation is later released
   * back to the bot. The inbox can still tell them apart by `handedOverAt`.
   */
  async recordAgentEcho(dto: AgentEchoDto) {
    const { producerId } = await this.getContext(dto.phoneNumberId)

    const conversation = await this.prisma.conversation.findFirst({
      where: { waId: dto.waId, producerId, deletedAt: null },
      select: { id: true, botPaused: true },
    })

    // No conversation yet means the employee wrote first, before the customer
    // ever reached the bot. Nothing to pause and no transcript to append to.
    if (!conversation) {
      return { conversationId: null, botPaused: false, created: false }
    }

    const created = await this.prisma.$transaction(async tx => {
      const inserted = await tx.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            role: 'assistant',
            content: dto.content,
            waMessageId: dto.waMessageId ?? null,
            source: 'app_echo',
          },
        ],
        skipDuplicates: true,
      })

      // Meta retries webhooks. The unique wamid turns a retry into a no-op
      // instead of a second transcript bubble and a second handover event.
      if (inserted.count === 0) return false

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          warnedAt: null,
          botPaused: true,
          status: 'open',
          // Only stamp the first handover of this stretch so the inbox can show
          // "since when" a human has been on it.
          ...(conversation.botPaused ? {} : { handedOverAt: new Date() }),
        },
      })

      return true
    })

    return { conversationId: conversation.id, botPaused: true, created }
  }

  async markWabaDisconnected(wabaId: string, reason?: string) {
    const result = await this.prisma.wabaAccount.updateMany({
      where: { wabaId },
      data: {
        disconnectedAt: new Date(),
        disconnectReason: reason?.slice(0, 64) ?? 'UNKNOWN',
      },
    })
    return { updated: result.count }
  }

  /**
   * Finds or creates the conversation for a WhatsApp user and returns its recent
   * history scoped to the current session.
   *
   * Lazy inactivity timeout: if the last message is older than the inactivity
   * window, the session boundary is moved to now so the previous transcript
   * drops out of the context window and the user starts from scratch. There is
   * no background job — the boundary is recomputed here on every inbound
   * message, so it costs nothing while the chat is idle. `newSession` lets the
   * bot greet the returning user again. The identified client link is kept.
   */
  async getOrCreateConversation(phoneNumberId: string, waId: string) {
    const { producerId } = await this.getContext(phoneNumberId)

    const CONVERSATION_SELECT = {
      id: true,
      sessionStartedAt: true,
      lastMessageAt: true,
      phoneNumberId: true,
      botPaused: true,
      status: true,
      flowState: true,
      clientLinkedAt: true,
      client: { select: CLIENT_SUMMARY_SELECT },
    } as const

    let conversation = await this.prisma.conversation.findFirst({
      where: { waId, producerId, deletedAt: null },
      select: CONVERSATION_SELECT,
    })

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { waId, producerId, phoneNumberId, sessionStartedAt: new Date() },
        select: CONVERSATION_SELECT,
      })
    }

    let sessionStartedAt = conversation.sessionStartedAt
    let newSession = false

    // Keep the originating number current (self-heals older rows) so proactive
    // warnings are sent from the number the user actually wrote to.
    const phoneChanged = conversation.phoneNumberId !== phoneNumberId

    const lastActivity = conversation.lastMessageAt
    if (lastActivity && Date.now() - lastActivity.getTime() > this.sessionTimeoutMs) {
      sessionStartedAt = new Date()
      newSession = true
    }

    // A new session means the previous flow is over: drop the persisted state so
    // the bot greets the returning user from scratch instead of resuming a stale step.
    const flowState = newSession ? null : conversation.flowState

    const shouldReopen = conversation.status === 'closed'

    if (newSession || phoneChanged || shouldReopen) {
      // warnedAt is left as-is here; saveMessage clears it when the user's new
      // message lands, which avoids a race with the inactivity sweep.
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(newSession ? { sessionStartedAt, flowState: null } : {}),
          ...(phoneChanged ? { phoneNumberId } : {}),
          ...(shouldReopen ? { status: 'open' } : {}),
        },
      })
    }

    // Regardless of the session: the last thing a person from the office (inbox
    // or WhatsApp Business app) wrote, so the bot can tell a customer who is
    // answering that person from someone starting a new conversation.
    const lastHumanReply = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        OR: [{ role: 'agent' }, { source: 'app_echo' }],
        createdAt: { gte: new Date(Date.now() - HUMAN_REPLY_LOOKBACK_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true, createdAt: true },
    })

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        ...(sessionStartedAt ? { createdAt: { gte: sessionStartedAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      // `source` lets the bot tell an employee's WhatsApp-app reply (app_echo)
      // from its own messages, so it can stay quiet when the customer is just
      // closing a conversation a person had with them.
      select: { id: true, role: true, content: true, createdAt: true, source: true },
    })

    const clientActive = isClientLinkActive({
      waId,
      sessionStartedAt,
      clientLinkedAt: conversation.clientLinkedAt,
      client: conversation.client,
    })

    return {
      conversationId: conversation.id,
      // The stored link may belong to an earlier session about someone else's
      // policy; the bot then treats the writer as unidentified and asks again.
      client: clientActive ? conversation.client : null,
      newSession,
      // BUGFIX: botPaused was selected above but never returned, so the bot
      // received `undefined` and kept replying even after an admin took over the
      // chat. Returning it makes the takeover (botPaused) actually mute the bot.
      botPaused: conversation.botPaused,
      // Durable deterministic flow state; the bot rehydrates from it so a restart
      // or deploy doesn't lose the user's place. Null = start fresh.
      flowState,
      messages: messages.reverse(),
      lastHumanReply: lastHumanReply
        ? { content: lastHumanReply.content, createdAt: lastHumanReply.createdAt.toISOString() }
        : null,
      // When this number last talked to us before this message, across sessions:
      // someone who wrote a few hours ago does not need the full introduction again.
      previousActivityAt: lastActivity ? lastActivity.toISOString() : null,
    }
  }

  /**
   * Persists the bot's deterministic flow state for a conversation (serialized
   * JSON, or null to clear it). This is what makes the bot stateless: it reloads
   * the snapshot on the next message instead of keeping it in process memory.
   */
  async saveFlowState(conversationId: number, flowState: string | null) {
    await this.findConversation(conversationId)
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { flowState },
    })
    return { ok: true }
  }

  /**
   * Resets the conversation session. Moves the session boundary to now so the
   * chat history drops out of the context window. Old messages stay in the DB
   * until the retention job prunes them.
   *
   * `unlinkClient` separates the two callers. Ending the chat ("finalizar") is a
   * normal goodbye and keeps the identified client, so the next visit still
   * greets them by name. The `/reset` dev command means "start from zero" and
   * clears the link too — keeping it left the bot greeting the previous person
   * ("¡Hola de nuevo, Lucas!") to whoever wrote next, which is exactly what the
   * command is meant to wipe.
   */
  async resetSession(conversationId: number, unlinkClient = false) {
    await this.findConversation(conversationId)
    await this.prisma.conversation.update({
      where: { id: conversationId },
      // lastMessageAt/warnedAt cleared so the sweep doesn't warn a just-reset chat;
      // flowState cleared so the next message starts the flow from scratch.
      data: {
        sessionStartedAt: new Date(),
        lastMessageAt: null,
        warnedAt: null,
        flowState: null,
        ...(unlinkClient ? { clientId: null, producerCodeId: null, clientLinkedAt: null } : {}),
      },
    })
    return { ok: true }
  }

  /**
   * Claims the conversations that have been idle past the inactivity window and
   * not yet warned, marking them warned in the same call so the same silence is
   * never warned twice. Returns what the bot needs to push the WhatsApp warning:
   * the user's waId and the Meta phone number the chat came through.
   *
   * The goodbye goes out whatever the hour: the session really does end, and a
   * user who is not told simply taps the buttons still on their screen and gets
   * a confusing "¡Hola de nuevo!" instead of their answer. `isOpenNow` is
   * carried so the notice can say we're closed rather than being suppressed.
   * Conversations with no stored phone number (legacy rows) are skipped until
   * the next inbound message backfills it.
   */
  async claimPendingWarnings(limit = 50) {
    const now = Date.now()
    const cutoff = new Date(now - this.sessionTimeoutMs)
    const windowStart = new Date(cutoff.getTime() - WARNING_WINDOW_MS)

    const claimed = await this.prisma.conversation.findMany({
      where: {
        deletedAt: null,
        producer: { botEnabled: true },
        warnedAt: null,
        phoneNumberId: { not: null },
        lastMessageAt: { not: null, lte: cutoff },
      },
      take: limit,
      select: {
        id: true,
        waId: true,
        phoneNumberId: true,
        botPaused: true,
        lastMessageAt: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true },
        },
        producer: { select: { id: true, businessHours: true } },
      },
    })

    if (claimed.length === 0) return []

    // Claim regardless of the hour so the same silence is never warned twice.
    await this.prisma.conversation.updateMany({
      where: { id: { in: claimed.map(c => c.id) } },
      data: { warnedAt: new Date() },
    })

    // Every claimed chat is finalized, but the goodbye only goes to a session
    // the bot was running and left waiting on the customer, right after the
    // timeout. Re-enabling the bot used to send it to every chat that piled up
    // while it was off — days-old ones and chats it never answered included —
    // and an advisor's chat got the bot's goodbye mid-conversation.
    const candidates = claimed.filter(
      c =>
        !c.botPaused &&
        c.lastMessageAt !== null &&
        c.lastMessageAt >= windowStart &&
        c.messages[0]?.role === 'assistant',
    )
    if (candidates.length === 0) return []

    // Each producer's own weekly schedule + active closures decide whether we are
    // open now: outside hours (or on a holiday) the chat is finalized silently.
    const producerIds = [...new Set(candidates.map(c => c.producer.id))]
    const today = new Date(`${toDateStr(new Date())}T00:00:00Z`)
    const closureRows = await this.prisma.businessClosure.findMany({
      where: { producerId: { in: producerIds }, deletedAt: null, endDate: { gte: today } },
      select: { producerId: true, startDate: true, endDate: true, reason: true },
    })
    const closuresByProducer = new Map<number, ActiveClosure[]>()
    for (const r of closureRows) {
      const list = closuresByProducer.get(r.producerId) ?? []
      list.push({ startDate: toDateStr(r.startDate), endDate: toDateStr(r.endDate), reason: r.reason })
      closuresByProducer.set(r.producerId, list)
    }

    const out: {
      conversationId: number
      waId: string
      phoneNumberId: string
      attentionHours: string
      isOpenNow: boolean
    }[] = []
    for (const c of candidates) {
      const status = computeStatus(parseSchedule(c.producer.businessHours), closuresByProducer.get(c.producer.id) ?? [])
      out.push({
        conversationId: c.id,
        waId: c.waId,
        phoneNumberId: String(c.phoneNumberId),
        // Carried so the bot's inactivity notice quotes the producer's own hours.
        attentionHours: status.formatted,
        isOpenNow: status.isOpenNow,
      })
    }
    return out
  }

  async saveMessage(conversationId: number, dto: SaveMessageDto) {
    await this.findConversation(conversationId)

    // Persist the message and refresh activity atomically so lastMessageAt can
    // never drift from the actual last message (and warnedAt is cleared with it).
    return this.prisma.$transaction(async tx => {
      const message = await tx.message.create({
        data: {
          conversationId,
          role: dto.role,
          content: dto.content,
          ...(dto.media
            ? {
                rawData: {
                  media: {
                    url: dto.media.url,
                    originalName: dto.media.originalName,
                    mimeType: dto.media.mimeType,
                    size: dto.media.size,
                    ...(dto.media.tipo ? { tipo: dto.media.tipo } : {}),
                  },
                } as Prisma.InputJsonValue,
              }
            : {}),
        },
        select: { id: true, role: true, content: true, createdAt: true },
      })

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: message.createdAt,
          warnedAt: null,
          ...(dto.role === 'user' ? { unreadCount: { increment: 1 } } : {}),
          ...(dto.role === 'user' && dto.contactName?.trim() ? { contactName: dto.contactName.trim() } : {}),
        },
      })

      return message
    })
  }

  /**
   * Links the conversation to a Client found by DNI or license plate.
   * This is what unlocks the client-only endpoints (polizas, cuotas, documentos, siniestros).
   */
  async identifyClient(conversationId: number, dto: IdentifyClientDto) {
    const conversation = await this.findConversation(conversationId)

    if (!dto.dni && !dto.plate) {
      throw new BadRequestException('Either dni or plate is required')
    }

    let client: { id: number; producerCodeId: number | null } | null = null

    if (dto.dni) {
      client = await this.prisma.client.findFirst({
        where: { dni: dto.dni.trim(), producerId: conversation.producerId, deletedAt: null },
        select: { id: true, producerCodeId: true },
      })
    }

    if (!client && dto.plate) {
      const plate = dto.plate.replace(/[\s-]/g, '').toUpperCase()
      const poliza = await this.prisma.poliza.findFirst({
        where: {
          producerId: conversation.producerId,
          deletedAt: null,
          vehiculo: { dominio: plate, deletedAt: null },
        },
        select: { clientId: true, producerCodeId: true },
      })
      if (poliza) client = { id: poliza.clientId, producerCodeId: poliza.producerCodeId }
    }

    if (!client) {
      throw new NotFoundException('No client found for the given dni/plate')
    }

    // Resolve the chat to the client's producer code so inbox/novedades scoping
    // routes it to the right admin even when the number serves several codes.
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { clientId: client.id, producerCodeId: client.producerCodeId, clientLinkedAt: new Date() },
      select: { client: { select: CLIENT_SUMMARY_SELECT } },
    })

    const polizasCount = await this.prisma.poliza.count({
      where: { clientId: client.id, deletedAt: null },
    })

    return { client: updated.client, polizasCount }
  }

  /**
   * The client's policies **in force today** — the only ones the bot offers for
   * a claim, documents or account status. Cancelled policies, expired ones and
   * renewals that haven't started yet stay out (see inForcePolizaWhere); the web
   * portal and panel still show them, labelled.
   *
   * No payment standing is attached: the synced installment statuses are not
   * reliable yet (most debit installments show as overdue), and gating claims
   * on them stopped legitimate claims. See estadoPago in common/poliza-vigencia.
   */
  async getPolizas(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    return this.prisma.poliza.findMany({
      where: { clientId, producerId, ...inForcePolizaWhere() },
      orderBy: { vigenciaHasta: 'desc' },
      select: POLIZA_SUMMARY_SELECT,
    })
  }

  /**
   * Account status across the client's **in-force** policies: unpaid
   * installments (pending / overdue / rejected) plus a paid count per policy.
   *
   * Only policies in force today are returned (see inForcePolizaWhere). Without
   * it the bot listed years of closed or cancelled policies with stale overdue
   * installments next to the live ones.
   */
  async getEstadoCuenta(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const polizas = await this.prisma.poliza.findMany({
      where: { clientId, producerId, ...inForcePolizaWhere() },
      select: {
        id: true,
        certificado: true,
        riskType: true,
        status: true,
        paymentMethod: true,
        vehiculo: { select: { dominio: true, marca: true, modelo: true } },
        cuotas: {
          where: { deletedAt: null },
          orderBy: { numeroCuota: 'asc' },
          select: { numeroCuota: true, amount: true, dueDate: true, status: true },
        },
      },
    })

    return polizas.map(poliza => {
      const { cuotas, ...rest } = poliza
      return {
        ...rest,
        cuotasPagas: cuotas.filter(c => c.status === 'paid').length,
        cuotasImpagas: cuotas.filter(c => c.status !== 'paid'),
        tieneRechazos: cuotas.some(c => c.status === 'rejected'),
      }
    })
  }

  /** Documents of a policy (tarjeta de circulación, certificado, cupón) fetched live from Triunfo. */
  async getDocumentos(conversationId: number, polizaId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const poliza = await this.prisma.poliza.findFirst({
      where: this.polizaRefWhere(polizaId, clientId, producerId),
      select: { certificado: true },
    })
    if (!poliza) throw new NotFoundException(`Policy ${polizaId} not found`)

    const documentos = await this.triunfo.getDocumentos(poliza.certificado)
    return documentos.map(doc => ({ codigo: doc.Codigo, nombre: doc.Nombre, url: doc.Url }))
  }

  async getSiniestros(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    return this.prisma.siniestro.findMany({
      where: { clientId, producerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipo: true,
        descripcion: true,
        fecha: true,
        estado: true,
        nroSiniestroCompania: true,
        createdAt: true,
        poliza: { select: { id: true, certificado: true, riskType: true } },
      },
    })
  }

  async createSiniestro(conversationId: number, dto: CreateBotSiniestroDto) {
    const { clientId, producerId, client } = await this.requireIdentifiedClient(conversationId)

    const poliza = await this.prisma.poliza.findFirst({
      where: { AND: [this.polizaRefWhere(dto.polizaId, clientId, producerId), inForcePolizaWhere()] },
      select: { id: true, certificado: true, company: true, producerCodeId: true },
    })
    if (!poliza) throw new NotFoundException(`Policy ${dto.polizaId} not found or not in force`)

    const siniestro = await this.prisma.siniestro.create({
      data: {
        tipo: dto.tipo,
        descripcion: dto.descripcion,
        fecha: new Date(dto.fecha),
        estado: 'pendiente',
        clientId,
        polizaId: poliza.id,
        producerId,
        producerCodeId: poliza.producerCodeId,
      },
      select: {
        id: true,
        tipo: true,
        descripcion: true,
        fecha: true,
        estado: true,
        nroSiniestroCompania: true,
        createdAt: true,
        poliza: { select: { id: true, certificado: true, riskType: true } },
      },
    })

    // Never blocks the response — MailService swallows its own errors.
    await this.mail.sendSiniestroNotification({
      siniestroId: siniestro.id,
      tipo: siniestro.tipo,
      descripcion: siniestro.descripcion,
      fecha: siniestro.fecha,
      cliente: { firstName: client.firstName, lastName: client.lastName, dni: client.dni, email: client.email },
      poliza: { certificado: poliza.certificado, company: poliza.company },
      adjuntosCount: 0,
    })

    await this.novedades.recordSiniestro(producerId, {
      siniestroId: siniestro.id,
      clientId,
      clienteNombre: `${client.firstName} ${client.lastName}`.trim(),
      descripcion: siniestro.descripcion,
      producerCodeId: poliza.producerCodeId,
    })

    return siniestro
  }

  /**
   * Attaches WhatsApp photos to the conversation's most recent open siniestro.
   * Images arrive as separate messages outside the LLM loop, so we target the
   * latest non-resolved claim of the identified client — filed within the last
   * 48 h when the photo did not come from a guided claim step. The total is
   * capped at MAX_FILES, keeping the most recent attachments.
   */
  async attachAdjuntos(conversationId: number, files: Express.Multer.File[], tipo?: string) {
    if (!files.length) throw new BadRequestException('No files received')

    // Multer has already persisted the upload. Build its durable metadata first
    // so a photo sent before a claim exists can still appear in the inbox.
    const attachments = await toStoredAdjuntos(files, tipo)
    // Deliberately the stored link, not the session-scoped one: photos for a
    // claim often arrive after the session expired, and they belong to the
    // open claim this same chat filed.
    const { clientId, producerId } = await this.findConversation(conversationId)

    if (!clientId) {
      return { siniestroId: null, adjuntosCount: 0, attached: false, attachments }
    }

    const siniestro = await this.prisma.siniestro.findFirst({
      where: {
        clientId,
        producerId,
        deletedAt: null,
        estado: { not: 'resuelto' },
        // The guided claim steps label their photos (tipo); a loose photo only
        // joins a claim filed recently. A moto photo sent to get a quote ended
        // up inside the client's old, still-open claim.
        ...(tipo ? {} : { createdAt: { gte: new Date(Date.now() - LOOSE_PHOTO_CLAIM_WINDOW_MS) } }),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, adjuntos: true },
    })
    if (!siniestro) {
      return { siniestroId: null, adjuntosCount: 0, attached: false, attachments }
    }

    const existing = Array.isArray(siniestro.adjuntos) ? (siniestro.adjuntos as unknown as AdjuntoMeta[]) : []
    const merged = [...existing, ...attachments].slice(-MAX_FILES)

    await this.prisma.siniestro.update({
      where: { id: siniestro.id },
      data: { adjuntos: merged as unknown as Prisma.InputJsonValue },
    })

    return { siniestroId: siniestro.id, adjuntosCount: merged.length, attached: true, attachments }
  }

  /**
   * Stores a WhatsApp voice note so the inbox can play it next to its
   * transcription. The bot saves the returned metadata with the message; the
   * file is deleted after AUDIO_RETENTION_DAYS (MessageRetentionService).
   */
  async storeAudio(conversationId: number, file: Express.Multer.File | undefined): Promise<AdjuntoMeta> {
    if (!file) throw new BadRequestException('No audio received')
    await this.findConversation(conversationId)
    return toAdjuntoMeta(file, undefined, AUDIOS_PUBLIC_PREFIX)
  }

  /** Marks the conversation as pending human attention (called by the bot when the user requests an advisor). */
  async requestHandoff(conversationId: number, reason?: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        id: true,
        status: true,
        waId: true,
        producerId: true,
        producerCodeId: true,
        clientId: true,
        contactName: true,
        sessionStartedAt: true,
        clientLinkedAt: true,
        client: { select: { firstName: true, lastName: true, phone: true } },
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    const client = isClientLinkActive(conversation) ? conversation.client : null

    // Already waiting for an agent — don't bump again or emit a duplicate novedad.
    if (conversation.status === 'pending' && !reason?.trim()) return { ok: true }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'pending' },
    })

    const clienteNombre = client
      ? `${client.firstName} ${client.lastName}`.trim()
      : (conversation.contactName ?? conversation.waId)
    await this.novedades.recordHandoff(conversation.producerId, {
      conversationId,
      reason,
      clientId: client ? conversation.clientId : null,
      clienteNombre,
      producerCodeId: conversation.producerCodeId,
    })

    return { ok: true }
  }

  /** Record a request for the office; never cancel the policy automatically. */
  async requestPolicyCancellation(conversationId: number, polizaId: number) {
    const { clientId, producerId, client } = await this.requireIdentifiedClient(conversationId)
    const poliza = await this.prisma.poliza.findFirst({
      where: { id: polizaId, clientId, producerId, deletedAt: null },
      select: { id: true, certificado: true, producerCodeId: true, vehiculo: { select: { dominio: true } } },
    })
    if (!poliza) throw new NotFoundException(`Policy ${polizaId} not found`)
    const body = `Póliza ${poliza.id}: ${poliza.certificado}${poliza.vehiculo?.dominio ? ` · Patente ${poliza.vehiculo.dominio}` : ''}. DNI ${client.dni}. El cliente solicita gestionar la baja; pendiente de confirmación de la oficina.`
    return this.prisma.$transaction(async tx => {
      const existing = await tx.novedad.findFirst({
        where: {
          producerId,
          type: 'baja_poliza',
          refId: conversationId,
          body,
          status: { not: 'resolved' },
          deletedAt: null,
        },
        select: { id: true },
      })
      const notification =
        existing ??
        (await tx.novedad.create({
          data: {
            producerId,
            producerCodeId: poliza.producerCodeId,
            clientId,
            type: 'baja_poliza',
            category: 'baja',
            refId: conversationId,
            title: `Solicitud de baja · ${client.firstName} ${client.lastName} · Póliza ${poliza.certificado}`,
            body,
          },
          select: { id: true },
        }))
      await tx.conversation.update({ where: { id: conversationId }, data: { status: 'pending' } })
      return { id: notification.id }
    })
  }

  // ─── Helpers ───────────────────────────────────────────

  /**
   * Locates one of the client's policies by the reference the bot passes, which
   * may be either the internal `id` or the visible `certificado` number — the
   * LLM routinely confuses the two (it shows the certificado to the user and
   * then sends it back as the id). Scoped to the identified client, so the OR
   * can never resolve to another client's policy.
   */
  private polizaRefWhere(ref: number, clientId: number, producerId: number) {
    return {
      clientId,
      producerId,
      deletedAt: null,
      OR: [{ id: ref }, { certificado: String(ref) }],
    }
  }

  private async findConversation(conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { id: true, producerId: true, clientId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return conversation
  }

  private async requireIdentifiedClient(conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        producerId: true,
        waId: true,
        sessionStartedAt: true,
        clientLinkedAt: true,
        client: { select: { ...CLIENT_SUMMARY_SELECT, deletedAt: true } },
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)

    const client = isClientLinkActive(conversation) ? conversation.client : null
    if (!client || client.deletedAt) {
      throw new ForbiddenException('Conversation has no identified client — call identify first')
    }

    return { clientId: client.id, producerId: conversation.producerId, client }
  }
}
