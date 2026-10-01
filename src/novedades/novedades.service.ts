import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ListNovedadesDto, NovedadType, MatterCategory, MatterStatus, UpdateMatterDto } from './dto/list-novedades.dto'

import { classifyMatter } from './classify-matter'
import { matterBrief } from './matter-brief'

const DEFAULT_PAGE_SIZE = 20

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
    },
  ): Promise<void> {
    await this.safeCreate(producerId, {
      category: MatterCategory.SINIESTRO,
      type: NovedadType.SINIESTRO,
      refId: input.siniestroId,
      clientId: input.clientId,
      producerCodeId: input.producerCodeId ?? null,
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
    },
  ): Promise<void> {
    const body = input.reason?.trim() || null
    // Exact repeats share a pending matter; a different request remains separate.
    const existing = await this.prisma.novedad
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
    await this.safeCreate(producerId, {
      category: classifyMatter(body ?? undefined),
      type: NovedadType.HANDOFF,
      refId: input.conversationId,
      clientId: input.clientId,
      producerCodeId: input.producerCodeId ?? null,
      title: `Pedido de asesor · ${input.clienteNombre}`,
      body,
    })
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
      title: string
      body: string | null
    },
  ): Promise<void> {
    try {
      await this.prisma.novedad.create({
        data: {
          producerId,
          category: data.category ?? MatterCategory.OTHER,
          type: data.type,
          refId: data.refId,
          clientId: data.clientId,
          producerCodeId: data.producerCodeId,
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

  async listForAdmin(producerId: number, codeIds: number[], dto: ListNovedadesDto) {
    const page = dto.page && dto.page > 0 ? dto.page : 1
    const pageSize = dto.pageSize && dto.pageSize > 0 ? dto.pageSize : DEFAULT_PAGE_SIZE
    const search = dto.search?.trim()
    const where: Prisma.NovedadWhereInput = {
      producerId,
      deletedAt: null,
      ...this.codeScope(codeIds),
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
      this.prisma.novedad.count({ where }),
      this.prisma.novedad.findMany({
        where,
        select: NOVEDAD_SELECT,
        // Strictly newest first; read state doesn't reorder the list.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      data: data.map(matter => ({ ...matter, ...matterBrief(matter) })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async getStats(producerId: number, codeIds: number[]) {
    const base = { producerId, deletedAt: null, readAt: null, ...this.codeScope(codeIds) }

    const [unreadTotal, unreadSiniestros, unreadHandoff, unreadBajas] = await this.prisma.$transaction([
      this.prisma.novedad.count({ where: base }),
      this.prisma.novedad.count({ where: { ...base, type: NovedadType.SINIESTRO } }),
      this.prisma.novedad.count({ where: { ...base, type: NovedadType.HANDOFF } }),
      this.prisma.novedad.count({ where: { ...base, type: NovedadType.BAJA_POLIZA } }),
    ])

    const categories = Object.values(MatterCategory)
    const counts = await this.prisma.$transaction(
      categories.map(category =>
        this.prisma.novedad.count({
          where: {
            producerId,
            deletedAt: null,
            ...this.codeScope(codeIds),
            category,
            status: { not: MatterStatus.RESOLVED },
          },
        }),
      ),
    )
    const actionableByCategory = Object.fromEntries(categories.map((category, i) => [category, counts[i]]))
    return {
      unreadTotal,
      unreadSiniestros,
      unreadHandoff,
      unreadBajas,
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
    },
  ) {
    try {
      const existing = await this.prisma.novedad.findFirst({
        where: { producerId, type: input.type, refId: input.refId, deletedAt: null },
        select: { id: true },
      })
      if (existing) {
        await this.prisma.novedad.update({
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
        title: `Solicitud de cotización · ${input.name}`,
        body: input.summary,
      })
    } catch (error) {
      this.logger.error(`Failed to record quote matter #${input.refId}`, error as Error)
    }
  }

  async registerVisit(userId: number) {
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { lastNovedadesVisitAt: true } })
      const visitedAt = new Date()
      await tx.user.update({ where: { id: userId }, data: { lastNovedadesVisitAt: visitedAt } })
      return { previousVisitAt: user.lastNovedadesVisitAt, visitedAt }
    })
  }

  async updateMatter(id: number, producerId: number, codeIds: number[], dto: UpdateMatterDto) {
    return this.prisma.$transaction(async tx => {
      const matter = await tx.novedad.findFirst({
        where: { id, producerId, deletedAt: null, ...this.codeScope(codeIds) },
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
            where: { id: matter.refId, producerId, deletedAt: null, ...this.codeScope(codeIds) },
            data: { status },
          })
        } else {
          await tx.solicitud.updateMany({
            where: { id: matter.refId, deletedAt: null, cotizacion: { producerId, ...this.codeScope(codeIds) } },
            data: { status },
          })
        }
      }
      return tx.novedad.update({
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

  async markRead(id: number, producerId: number, codeIds: number[]) {
    const novedad = await this.prisma.novedad.findFirst({
      where: { id, producerId, deletedAt: null, ...this.codeScope(codeIds) },
      select: { id: true, readAt: true },
    })
    if (!novedad) throw new NotFoundException(`Novedad ${id} not found`)

    // Idempotent: only stamp readAt the first time.
    if (novedad.readAt) {
      return this.prisma.novedad.findFirstOrThrow({ where: { id }, select: NOVEDAD_SELECT })
    }

    return this.prisma.novedad.update({
      where: { id },
      data: { readAt: new Date() },
      select: NOVEDAD_SELECT,
    })
  }

  async markAllRead(producerId: number, codeIds: number[], type?: NovedadType) {
    const result = await this.prisma.novedad.updateMany({
      where: { producerId, deletedAt: null, readAt: null, ...this.codeScope(codeIds), ...(type ? { type } : {}) },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }
}
