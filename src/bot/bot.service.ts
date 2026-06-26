import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { MailService } from '../mail/mail.service'
import { NovedadesService } from '../novedades/novedades.service'
import { UsageService } from '../usage/usage.service'
import { SaveMessageDto } from './dto/save-message.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'
import { AdjuntoMeta, MAX_FILES, toAdjuntoMeta } from '../siniestros/siniestro-upload.config'
import { type ActiveClosure, computeStatus, formatSchedule, parseSchedule } from '../business-hours/schedule'

// Inactivity window after which a chat is considered finished (see getOrCreateConversation).
const DEFAULT_SESSION_TIMEOUT_MINUTES = 5

const toDateStr = (d: Date): string => d.toISOString().slice(0, 10)

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

    const { id, name, slug, botName, businessHours, systemPrompt } = phoneNumber.producer
    // The bot shows the formatted week as its general "horario" line; richer
    // open-now info comes from GET /public/hours when a user asks.
    const attentionHours = formatSchedule(parseSchedule(businessHours))
    // When the number is over its monthly budget, the bot disables the paid LLM
    // (deterministic flows keep working at zero token cost).
    const llmEnabled = await this.usage.isLlmEnabled(phoneNumberId)
    return { producerId: id, producerName: name, producerSlug: slug, botName, attentionHours, systemPrompt, llmEnabled }
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
      flowState: true,
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

    if (newSession || phoneChanged) {
      // warnedAt is left as-is here; saveMessage clears it when the user's new
      // message lands, which avoids a race with the inactivity sweep.
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(newSession ? { sessionStartedAt, flowState: null } : {}),
          ...(phoneChanged ? { phoneNumberId } : {}),
        },
      })
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        ...(sessionStartedAt ? { createdAt: { gte: sessionStartedAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, role: true, content: true, createdAt: true },
    })

    return {
      conversationId: conversation.id,
      client: conversation.client,
      newSession,
      // BUGFIX: botPaused was selected above but never returned, so the bot
      // received `undefined` and kept replying even after an admin took over the
      // chat. Returning it makes the takeover (botPaused) actually mute the bot.
      botPaused: conversation.botPaused,
      // Durable deterministic flow state; the bot rehydrates from it so a restart
      // or deploy doesn't lose the user's place. Null = start fresh.
      flowState,
      messages: messages.reverse(),
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
   * Resets the conversation session (secret /reset dev command). Moves the
   * session boundary to now so the chat history drops out of the context
   * window; the identified client link is intentionally kept. Old messages stay
   * in the DB until the retention job prunes them.
   */
  async resetSession(conversationId: number) {
    await this.findConversation(conversationId)
    await this.prisma.conversation.update({
      where: { id: conversationId },
      // lastMessageAt/warnedAt cleared so the sweep doesn't warn a just-reset chat;
      // flowState cleared so the next message starts the flow from scratch.
      data: { sessionStartedAt: new Date(), lastMessageAt: null, warnedAt: null, flowState: null },
    })
    return { ok: true }
  }

  /**
   * Claims the conversations that have been idle past the inactivity window and
   * not yet warned, marking them warned in the same call so the same silence is
   * never warned twice. Returns what the bot needs to push the WhatsApp warning:
   * the user's waId and the Meta phone number the chat came through.
   *
   * The chat is always finalized (claimed); the warning is only **returned**
   * during office hours — outside them it is finalized silently. Conversations
   * with no stored phone number (legacy rows) are skipped until the next inbound
   * message backfills it.
   */
  async claimPendingWarnings(limit = 50) {
    const cutoff = new Date(Date.now() - this.sessionTimeoutMs)

    const candidates = await this.prisma.conversation.findMany({
      where: {
        deletedAt: null,
        warnedAt: null,
        phoneNumberId: { not: null },
        lastMessageAt: { not: null, lte: cutoff },
      },
      take: limit,
      select: {
        id: true,
        waId: true,
        phoneNumberId: true,
        producer: { select: { id: true, businessHours: true } },
      },
    })

    if (candidates.length === 0) return []

    // Claim regardless of the hour so the same silence is never warned twice.
    await this.prisma.conversation.updateMany({
      where: { id: { in: candidates.map(c => c.id) } },
      data: { warnedAt: new Date() },
    })

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

    const out: { conversationId: number; waId: string; phoneNumberId: string; attentionHours: string }[] = []
    for (const c of candidates) {
      const status = computeStatus(parseSchedule(c.producer.businessHours), closuresByProducer.get(c.producer.id) ?? [])
      if (!status.isOpenNow) continue
      out.push({
        conversationId: c.id,
        waId: c.waId,
        phoneNumberId: String(c.phoneNumberId),
        // Carried so the bot's inactivity notice quotes the producer's own hours.
        attentionHours: status.formatted,
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
        data: { conversationId, role: dto.role, content: dto.content },
        select: { id: true, role: true, content: true, createdAt: true },
      })

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt, warnedAt: null },
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
      data: { clientId: client.id, producerCodeId: client.producerCodeId },
      select: { client: { select: CLIENT_SUMMARY_SELECT } },
    })

    const polizasCount = await this.prisma.poliza.count({
      where: { clientId: client.id, deletedAt: null },
    })

    return { client: updated.client, polizasCount }
  }

  async getPolizas(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    return this.prisma.poliza.findMany({
      where: { clientId, producerId, deletedAt: null },
      orderBy: { vigenciaHasta: 'desc' },
      select: POLIZA_SUMMARY_SELECT,
    })
  }

  /**
   * Account status across all the client's policies: unpaid installments
   * (pending / overdue / rejected) plus a paid count per policy.
   */
  async getEstadoCuenta(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const polizas = await this.prisma.poliza.findMany({
      where: { clientId, producerId, deletedAt: null },
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
      where: this.polizaRefWhere(dto.polizaId, clientId, producerId),
      select: { id: true, certificado: true, company: true, producerCodeId: true },
    })
    if (!poliza) throw new NotFoundException(`Policy ${dto.polizaId} not found`)

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
   * latest non-resolved claim of the identified client. The total is capped at
   * MAX_FILES, keeping the most recent attachments.
   */
  async attachAdjuntos(conversationId: number, files: Express.Multer.File[]) {
    if (!files.length) throw new BadRequestException('No files received')

    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const siniestro = await this.prisma.siniestro.findFirst({
      where: { clientId, producerId, deletedAt: null, estado: { not: 'resuelto' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, adjuntos: true },
    })
    if (!siniestro) {
      throw new NotFoundException('No open siniestro to attach photos to')
    }

    const existing = Array.isArray(siniestro.adjuntos) ? (siniestro.adjuntos as unknown as AdjuntoMeta[]) : []
    const merged = [...existing, ...files.map(toAdjuntoMeta)].slice(-MAX_FILES)

    await this.prisma.siniestro.update({
      where: { id: siniestro.id },
      data: { adjuntos: merged as unknown as Prisma.InputJsonValue },
    })

    return { siniestroId: siniestro.id, adjuntosCount: merged.length }
  }

  /** Marks the conversation as pending human attention (called by the bot when the user requests an advisor). */
  async requestHandoff(conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        id: true,
        status: true,
        waId: true,
        producerId: true,
        producerCodeId: true,
        clientId: true,
        client: { select: { firstName: true, lastName: true } },
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)

    // Already waiting for an agent — don't bump again or emit a duplicate novedad.
    if (conversation.status === 'pending') return { ok: true }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'pending' },
    })

    const clienteNombre = conversation.client
      ? `${conversation.client.firstName} ${conversation.client.lastName}`.trim()
      : conversation.waId
    await this.novedades.recordHandoff(conversation.producerId, {
      conversationId,
      clientId: conversation.clientId,
      clienteNombre,
      producerCodeId: conversation.producerCodeId,
    })

    return { ok: true }
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
        client: { select: { ...CLIENT_SUMMARY_SELECT, deletedAt: true } },
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)

    const { client } = conversation
    if (!client || client.deletedAt) {
      throw new ForbiddenException('Conversation has no identified client — call identify first')
    }

    return { clientId: client.id, producerId: conversation.producerId, client }
  }
}
