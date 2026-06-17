import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { MailService } from '../mail/mail.service'
import { SaveMessageDto } from './dto/save-message.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'
import { AdjuntoMeta, MAX_FILES, toAdjuntoMeta } from '../siniestros/siniestro-upload.config'

// Inactivity window after which a chat is considered finished (see getOrCreateConversation).
const DEFAULT_SESSION_TIMEOUT_MINUTES = 5

// Office hours (Argentina) for the proactive inactivity warning. Outside this
// window the chat is still finalized, but no WhatsApp notice is pushed.
const BUSINESS_TZ = 'America/Argentina/Buenos_Aires'
const BUSINESS_START_HOUR = 8
const BUSINESS_END_HOUR = 16

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
        producer: { select: { id: true, name: true, slug: true, systemPrompt: true, isActive: true } },
      },
    })
    if (!phoneNumber || !phoneNumber.producer.isActive) {
      throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    }

    const { id, name, slug, systemPrompt } = phoneNumber.producer
    return { producerId: id, producerName: name, producerSlug: slug, systemPrompt }
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

    if (newSession || phoneChanged) {
      // warnedAt is left as-is here; saveMessage clears it when the user's new
      // message lands, which avoids a race with the inactivity sweep.
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(newSession ? { sessionStartedAt } : {}),
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
      messages: messages.reverse(),
    }
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
      // lastMessageAt/warnedAt cleared so the sweep doesn't warn a just-reset chat.
      data: { sessionStartedAt: new Date(), lastMessageAt: null, warnedAt: null },
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
      select: { id: true, waId: true, phoneNumberId: true },
    })

    if (candidates.length === 0) return []

    // Claim regardless of the hour so the same silence is never warned twice.
    await this.prisma.conversation.updateMany({
      where: { id: { in: candidates.map(c => c.id) } },
      data: { warnedAt: new Date() },
    })

    // Outside office hours the chat is finalized silently (no WhatsApp notice).
    if (!this.isWithinBusinessHours()) return []

    return candidates.map(c => ({
      conversationId: c.id,
      waId: c.waId,
      phoneNumberId: String(c.phoneNumberId),
    }))
  }

  /** True on weekdays (Mon–Fri) within office hours, evaluated in Argentina time. */
  private isWithinBusinessHours(now = new Date()): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TZ,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const weekday = parts.find(p => p.type === 'weekday')?.value
    const hour = Number(parts.find(p => p.type === 'hour')?.value)
    const isWeekday = weekday !== 'Sat' && weekday !== 'Sun'

    return isWeekday && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR
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

    let client: { id: number } | null = null

    if (dto.dni) {
      client = await this.prisma.client.findFirst({
        where: { dni: dto.dni.trim(), producerId: conversation.producerId, deletedAt: null },
        select: { id: true },
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
        select: { clientId: true },
      })
      if (poliza) client = { id: poliza.clientId }
    }

    if (!client) {
      throw new NotFoundException('No client found for the given dni/plate')
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { clientId: client.id },
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
      select: { id: true, certificado: true, company: true },
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
    await this.findConversation(conversationId)
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'pending' },
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
