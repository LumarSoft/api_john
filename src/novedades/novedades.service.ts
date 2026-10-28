import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { type ChatScope, numberWhere } from '../common/scope/scope.service'
import { ListNovedadesDto, NovedadType, MatterCategory, MatterStatus, UpdateMatterDto } from './dto/list-novedades.dto'

import { classifyMatter } from './classify-matter'

const DEFAULT_PAGE_SIZE = 20

/** How long an open advisor request keeps absorbing what the customer adds. */
const HANDOFF_JOIN_WINDOW_MS = 24 * 60 * 60_000

// Shape returned to the admin panel. The full detail of the referenced entity
// is fetched separately (e.g. GET /admin/siniestros/:refId) when opened.
const NOVEDAD_SELECT = {
  category: true,
  status: true,
  resolvedAt: true,
  id: true,
  type: true,
  refId: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  client: { select: { id: true, firstName: true, lastName: true, dni: true } },
} as const

@Injectable()
export class NovedadesService {
  private readonly logger = new Logger(NovedadesService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ─── Emission (called by other modules; never blocks the caller) ───

  async recordSiniestro(
    producerId: number,
    input: {
      siniestroId: number
      clientId: number
      clienteNombre: string
      descripcion: string
      producerCodeId?: number | null
      /** Meta id of the number the claim came through; null from the panel. */
      phoneNumberId?: string | null
    },
  ): Promise<void> {
    await this.safeCreate(producerId, {
      category: MatterCategory.SINIESTRO,
      type: NovedadType.SINIESTRO,
      refId: input.siniestroId,
      clientId: input.clientId,
      producerCodeId: input.producerCodeId ?? null,
      phoneNumberId: input.phoneNumberId ?? null,
      title: `Nuevo siniestro · ${input.clienteNombre}`,
      body: input.descripcion,
    })
  }

  async recordHandoff(
    producerId: number,
    input: {
      reason?: string
      conversationId: number
      clientId: number | null
      clienteNombre: string
      producerCodeId?: number | null
      /** Meta id of the number the chat came through. */
      phoneNumberId?: string | null
    },
  ): Promise<void> {
    const body = input.reason?.trim() || null
    const category = classifyMatter(body ?? undefined)
    // Exact repeats share a pending matter; a different request remains separate.
    const existing = await this.prisma.notification
      .findFirst({
        where: {
          producerId,
          type: NovedadType.HANDOFF,
          refId: input.conversationId,
          body,
          status: { not: MatterStatus.RESOLVED },
          deletedAt: null,
        },
        select: { id: true },
      })
      .catch(() => null)
    if (existing) return
    if (await this.joinOpenHandoff(input.conversationId, producerId, body, category)) return
    await this.safeCreate(producerId, {
      category,
      type: NovedadType.HANDOFF,
      refId: input.conversationId,
      clientId: input.clientId,
      producerCodeId: input.producerCodeId ?? null,
      phoneNumberId: input.phoneNumberId ?? null,
      title: `Pedido de asesor · ${input.clienteNombre}`,
      body,
    })
  }

  /** Matters that live in a chat and are settled by answering it. */
  private static readonly CHAT_MATTER_TYPES = [NovedadType.HANDOFF, NovedadType.BAJA_POLIZA]

  /**
   * The office wrote in the chat (from the panel or the WhatsApp Business app):
   * the matters it was asked for are being handled. The administrator works
   * from the app and never came back to mark them, so 60 of 64 pending
   * requests had already been answered (22/10). Never throws.
   */
  async markConversationAnswered(conversationId: number, answeredAt = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.notification.updateMany({
        where: {
          type: { in: NovedadesService.CHAT_MATTER_TYPES },
          refId: conversationId,
          status: MatterStatus.PENDING,
          createdAt: { lte: answeredAt },
          deletedAt: null,
        },
        data: { status: MatterStatus.IN_PROGRESS },
      })
      return count
    } catch (error) {
      this.logger.error(`Failed to mark matters of conversation #${conversationId} as answered`, error as Error)
      return 0
    }
  }

  /**
   * The chat went back to the bot (manually or by the takeover timeout): what
   * the office was handling there is done. Matters nobody answered stay
   * pending so they are not lost. Never throws.
   */
  async resolveAnsweredMatters(conversationId: number): Promise<number> {
    try {
      const { count } = await this.prisma.notification.updateMany({
        where: {
          type: { in: NovedadesService.CHAT_MATTER_TYPES },
          refId: conversationId,
          status: MatterStatus.IN_PROGRESS,
          deletedAt: null,
        },
        data: { status: MatterStatus.RESOLVED, resolvedAt: new Date() },
      })
      return count
    } catch (error) {
      this.logger.error(`Failed to resolve matters of conversation #${conversationId}`, error as Error)
      return 0
    }
  }

  /**
   * The customer adding to what they already asked in this chat — the reason
   * typed after "asesor", a second message for Mili, "consultar por los
   * certificados" after asking for them — joins that open matter instead of
   * opening another one: one chat got three alerts for the same papers. Only
   * within HANDOFF_JOIN_WINDOW_MS and the same kind of matter (a generic one
   * takes any), so a payment and a cancellation still stay apart. The joined
   * matter is marked unread and moved up so the office sees the addition.
   */
  private async joinOpenHandoff(
    conversationId: number,
    producerId: number,
    body: string | null,
    category: MatterCategory,
  ): Promise<boolean> {
    try {
      const open = await this.prisma.notification.findFirst({
        where: {
          producerId,
          type: NovedadType.HANDOFF,
          refId: conversationId,
          status: { not: MatterStatus.RESOLVED },
          deletedAt: null,
          createdAt: { gte: new Date(Date.now() - HANDOFF_JOIN_WINDOW_MS) },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, body: true, category: true },
      })
      if (!open) return false
      const openCategory = open.category as MatterCategory
      if (openCategory !== category && openCategory !== MatterCategory.OTHER && category !== MatterCategory.OTHER)
        return false
      if (!body || open.body?.includes(body)) return true
      await this.prisma.notification.update({
        where: { id: open.id },
        data: {
          body: open.body ? `${open.body}\n\n${body}` : body,
          category: openCategory === MatterCategory.OTHER ? category : openCategory,
          // The customer wrote again: the matter waits for the office once more.
          status: MatterStatus.PENDING,
          readAt: null,
          createdAt: new Date(),
        },
      })
      return true
    } catch (error) {
      this.logger.error(`Failed to join handoff of conversation #${conversationId}`, error as Error)
      return false
    }
  }

  // A failed notification must never break the originating action (claim
  // creation, handoff). Log and move on, mirroring MailService's behavior.
  private async safeCreate(
    producerId: number,
    data: {
      category?: MatterCategory
      type: NovedadType
      refId: number
      clientId: number | null
      producerCodeId: number | null
      phoneNumberId?: string | null
      title: string
      body: string | null
    },
  ): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          producerId,
          category: data.category ?? MatterCategory.OTHER,
          type: data.type,
          refId: data.refId,
          clientId: data.clientId,
          producerCodeId: data.producerCodeId,
          phoneNumberId: data.phoneNumberId ?? null,
          title: data.title,
          body: data.body,
        },
      })
    } catch (error) {
      this.logger.error(`Failed to record novedad (${data.type} #${data.refId})`, error as Error)
    }
  }

  // ─── Admin panel ───────────────────────────────────────

  // Code-level visibility for an admin. Includes novedades not yet attributed to
  // a code (handoffs from unidentified numbers) so they stay visible to the org.
  private codeScope(codeIds: number[]) {
    return { OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }] }
  }

  /**
   * The novedades a user sees: by code (codeScope) and by the number they came
   * through (numberWhere): an admin only their own numbers', the SuperAdmin
   * everything or the number they filtered by.
   */
  private matterScope(_producerId: number, scope: ChatScope): Prisma.NotificationWhereInput {
    const byCode = this.codeScope(scope.codeIds)
    const byNumber = numberWhere(scope)
    return Object.keys(byNumber).length ? { AND: [byCode, byNumber] } : byCode
  }

  async listForAdmin(producerId: number, scope: ChatScope, dto: ListNovedadesDto) {
    const page = dto.page && dto.page > 0 ? dto.page : 1
    const pageSize = dto.pageSize && dto.pageSize > 0 ? dto.pageSize : DEFAULT_PAGE_SIZE
    const search = dto.search?.trim()
    const where: Prisma.NotificationWhereInput = {
      producerId,
      deletedAt: null,
      ...this.matterScope(producerId, scope),
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.status ? { status: dto.status } : dto.actionable ? { status: { not: MatterStatus.RESOLVED } } : {}),
      ...(dto.since ? { createdAt: { gt: new Date(dto.since) } } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.unread ? { readAt: null } : {}),
      ...(dto.clientId ? { clientId: dto.clientId } : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: search } },
                  { body: { contains: search } },
                  {
                    client: {
                      OR: [
                        { firstName: { contains: search } },
                        { lastName: { contains: search } },
                        { dni: { contains: search } },
                      ],
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        select: NOVEDAD_SELECT,
        // Strictly newest first; read state doesn't reorder the list.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  /** Clears notifications only, leaving their underlying business records intact. */
  async clearAll(producerId: number, scope: ChatScope) {
    const result = await this.prisma.notification.updateMany({
      where: { producerId, deletedAt: null, ...this.matterScope(producerId, scope) },
      data: { deletedAt: new Date() },
    })
    return { clearedCount: result.count }
  }

  async getStats(producerId: number, scope: ChatScope) {
    const visible = this.matterScope(producerId, scope)
    const base = { producerId, deletedAt: null, readAt: null, ...visible }

    const [unreadTotal, unreadClaims, unreadHandoff, unreadCancellations] = await this.prisma.$transaction([
      this.prisma.notification.count({ where: base }),
      this.prisma.notification.count({ where: { ...base, type: NovedadType.SINIESTRO } }),
      this.prisma.notification.count({ where: { ...base, type: NovedadType.HANDOFF } }),
      this.prisma.notification.count({ where: { ...base, type: NovedadType.BAJA_POLIZA } }),
    ])

    const categories = Object.values(MatterCategory)
    const counts = await this.prisma.$transaction(
      categories.map(category =>
        this.prisma.notification.count({
          where: {
            producerId,
            deletedAt: null,
            ...visible,
            category,
            status: { not: MatterStatus.RESOLVED },
          },
        }),
      ),
    )
    const actionableByCategory = Object.fromEntries(categories.map((category, i) => [category, counts[i]]))
    return {
      unreadTotal,
      unreadClaims,
      unreadHandoff,
      unreadCancellations,
      actionableByCategory,
      actionableTotal: counts.reduce((a, b) => a + b, 0),
    }
  }

  async recordQuote(
    producerId: number,
    input: {
      type: NovedadType.LEAD | NovedadType.SOLICITUD
      refId: number
      name: string
      summary: string
      producerCodeId?: number | null
      /** Meta id of the number the request came through; null for the web. */
      phoneNumberId?: string | null
    },
  ) {
    try {
      const existing = await this.prisma.notification.findFirst({
        where: { producerId, type: input.type, refId: input.refId, deletedAt: null },
        select: { id: true },
      })
      if (existing) {
        await this.prisma.notification.update({
          where: { id: existing.id },
          data: {
            title: `Solicitud de cotización · ${input.name}`,
            body: input.summary,
            status: MatterStatus.PENDING,
            resolvedAt: null,
            readAt: null,
            createdAt: new Date(),
          },
        })
        return
      }
      await this.safeCreate(producerId, {
        type: input.type,
        refId: input.refId,
        category: MatterCategory.COTIZACION,
        clientId: null,
        producerCodeId: input.producerCodeId ?? null,
        phoneNumberId: input.phoneNumberId ?? null,
        title: `Solicitud de cotización · ${input.name}`,
        body: input.summary,
      })
    } catch (error) {
      this.logger.error(`Failed to record quote matter #${input.refId}`, error as Error)
    }
  }

  async registerVisit(userId: number) {
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lastNotificationsVisitAt: true },
      })
      const visitedAt = new Date()
      await tx.user.update({ where: { id: userId }, data: { lastNotificationsVisitAt: visitedAt } })
      return { previousVisitAt: user.lastNotificationsVisitAt, visitedAt }
    })
  }

  async updateMatter(id: number, producerId: number, scope: ChatScope, dto: UpdateMatterDto) {
    const visible = await this.matterScope(producerId, scope)
    return this.prisma.$transaction(async tx => {
      const matter = await tx.notification.findFirst({
        where: { id, producerId, deletedAt: null, ...visible },
        select: { type: true, refId: true },
      })
      if (!matter) throw new NotFoundException(`Novedad ${id} not found`)
      // Quote requests use the same state in both entry points.
      if (dto.status && (matter.type === NovedadType.LEAD || matter.type === NovedadType.SOLICITUD)) {
        const status =
          dto.status === MatterStatus.RESOLVED
            ? 'CLOSED'
            : dto.status === MatterStatus.IN_PROGRESS
              ? 'CONTACTED'
              : 'NEW'
        if (matter.type === NovedadType.LEAD) {
          await tx.contactLead.updateMany({
            where: { id: matter.refId, producerId, deletedAt: null, ...this.codeScope(scope.codeIds) },
            data: { status },
          })
        } else {
          await tx.quoteRequest.updateMany({
            where: { id: matter.refId, deletedAt: null, quote: { producerId, ...this.codeScope(scope.codeIds) } },
            data: { status },
          })
        }
      }
      return tx.notification.update({
        where: { id },
        data: {
          ...(dto.category ? { category: dto.category } : {}),
          ...(dto.status
            ? { status: dto.status, resolvedAt: dto.status === MatterStatus.RESOLVED ? new Date() : null }
            : {}),
        },
        select: NOVEDAD_SELECT,
      })
    })
  }

  async markRead(id: number, producerId: number, scope: ChatScope) {
    const novedad = await this.prisma.notification.findFirst({
      where: { id, producerId, deletedAt: null, ...(await this.matterScope(producerId, scope)) },
      select: { id: true, readAt: true },
    })
    if (!novedad) throw new NotFoundException(`Novedad ${id} not found`)

    // Idempotent: only stamp readAt the first time.
    if (novedad.readAt) {
      return this.prisma.notification.findFirstOrThrow({ where: { id }, select: NOVEDAD_SELECT })
    }

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: NOVEDAD_SELECT,
    })
  }

  async markAllRead(producerId: number, scope: ChatScope, type?: NovedadType) {
    const result = await this.prisma.notification.updateMany({
      where: {
        producerId,
        deletedAt: null,
        readAt: null,
        ...(await this.matterScope(producerId, scope)),
        ...(type ? { type } : {}),
      },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }
}
