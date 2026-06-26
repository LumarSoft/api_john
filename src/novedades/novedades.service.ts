import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ListNovedadesDto, NovedadType } from './dto/list-novedades.dto'

const DEFAULT_PAGE_SIZE = 20

// Shape returned to the admin panel. The full detail of the referenced entity
// is fetched separately (e.g. GET /admin/siniestros/:refId) when opened.
const NOVEDAD_SELECT = {
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
      conversationId: number
      clientId: number | null
      clienteNombre: string
      producerCodeId?: number | null
    },
  ): Promise<void> {
    await this.safeCreate(producerId, {
      type: NovedadType.HANDOFF,
      refId: input.conversationId,
      clientId: input.clientId,
      producerCodeId: input.producerCodeId ?? null,
      title: `Pedido de asesor · ${input.clienteNombre}`,
      body: null,
    })
  }

  // A failed notification must never break the originating action (claim
  // creation, handoff). Log and move on, mirroring MailService's behavior.
  private async safeCreate(
    producerId: number,
    data: {
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
  private codeScope(codeIds: number[]): Prisma.NovedadWhereInput {
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
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.unread ? { readAt: null } : {}),
      ...(dto.clientId ? { clientId: dto.clientId } : {}),
      ...(search
        ? {
            client: {
              OR: [
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { dni: { contains: search } },
              ],
            },
          }
        : {}),
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.novedad.count({ where }),
      this.prisma.novedad.findMany({
        where,
        select: NOVEDAD_SELECT,
        // Unread first, then newest.
        orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
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

  async getStats(producerId: number, codeIds: number[]) {
    const base = { producerId, deletedAt: null, readAt: null, ...this.codeScope(codeIds) }

    const [unreadTotal, unreadSiniestros, unreadHandoff] = await this.prisma.$transaction([
      this.prisma.novedad.count({ where: base }),
      this.prisma.novedad.count({ where: { ...base, type: NovedadType.SINIESTRO } }),
      this.prisma.novedad.count({ where: { ...base, type: NovedadType.HANDOFF } }),
    ])

    return { unreadTotal, unreadSiniestros, unreadHandoff }
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
