import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ImprovementArea, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateImprovementDto, UpdateImprovementDto } from './dto/improvement.dto'

const PUBLIC_SELECT = {
  id: true,
  title: true,
  summary: true,
  beforeText: true,
  afterText: true,
  example: true,
  area: true,
  releasedOn: true,
  publishedAt: true,
} as const

const OWNER_SELECT = {
  ...PUBLIC_SELECT,
  producerId: true,
  producer: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} as const

export interface ImprovementView {
  id: number
  title: string
  summary: string
  beforeText: string | null
  afterText: string | null
  example: string | null
  area: ImprovementArea
  releasedOn: Date | null
  publishedAt: Date | null
}

/** Optional long texts: an empty box in the editor means "none", not an empty paragraph. */
function optionalText(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** YYYY-MM-DD → a DATE column value (midnight UTC, so the day never shifts). */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  return value === null ? null : new Date(`${value}T00:00:00Z`)
}

/** Today's date in Argentina, as a DATE column value. */
function today(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  return new Date(`${ymd}T00:00:00Z`)
}

@Injectable()
export class ImprovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What an organization's users can read: published, for them or for everyone. */
  private visibleTo(producerId: number): Prisma.ImprovementWhereInput {
    return {
      deletedAt: null,
      publishedAt: { not: null },
      OR: [{ producerId }, { producerId: null }],
    }
  }

  async listPublished(producerId: number): Promise<ImprovementView[]> {
    return this.prisma.improvement.findMany({
      where: this.visibleTo(producerId),
      // By the date of the change: an older improvement published today stays in its place.
      orderBy: [{ releasedOn: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      select: PUBLIC_SELECT,
    })
  }

  /** Published improvements this user hasn't seen yet (all of them before their first visit). */
  async countUnseen(userId: number, producerId: number): Promise<{ count: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastImprovementsVisitAt: true },
    })
    const where = this.visibleTo(producerId)
    const count = await this.prisma.improvement.count({
      where: user.lastImprovementsVisitAt
        ? { ...where, publishedAt: { not: null, gt: user.lastImprovementsVisitAt } }
        : where,
    })
    return { count }
  }

  /**
   * Marks "Mejoras" as seen now and returns the previous visit, so the page can
   * still badge as new what was published since then.
   */
  async registerVisit(userId: number): Promise<{ previousVisitAt: Date | null; visitedAt: Date }> {
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lastImprovementsVisitAt: true },
      })
      const visitedAt = new Date()
      await tx.user.update({ where: { id: userId }, data: { lastImprovementsVisitAt: visitedAt } })
      return { previousVisitAt: user.lastImprovementsVisitAt, visitedAt }
    })
  }

  // ── OWNER (Lumar) ─────────────────────────────────────

  async listAll() {
    return this.prisma.improvement.findMany({
      where: { deletedAt: null },
      // Same order the organizations read them in; the editor filters drafts apart.
      orderBy: [{ releasedOn: { sort: 'desc', nulls: 'first' } }, { id: 'desc' }],
      select: OWNER_SELECT,
    })
  }

  async create(dto: CreateImprovementDto) {
    await this.assertOrganization(dto.producerId)
    return this.prisma.improvement.create({
      data: {
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        beforeText: optionalText(dto.beforeText) ?? null,
        afterText: optionalText(dto.afterText) ?? null,
        example: optionalText(dto.example) ?? null,
        area: dto.area,
        // Published without a date → it happened today, so it sorts with the rest.
        releasedOn: toDate(dto.releasedOn) ?? (dto.published ? today() : null),
        producerId: dto.producerId ?? null,
        publishedAt: dto.published ? new Date() : null,
      },
      select: OWNER_SELECT,
    })
  }

  async update(id: number, dto: UpdateImprovementDto) {
    const current = await this.findOrThrow(id)
    if (dto.producerId !== undefined) await this.assertOrganization(dto.producerId)

    // Re-publishing keeps the original date, so editing a typo doesn't make an
    // old improvement show up as new to everyone again.
    let publishedAt: Date | null | undefined
    if (dto.published === true) publishedAt = current.publishedAt ?? new Date()
    if (dto.published === false) publishedAt = null

    let releasedOn = toDate(dto.releasedOn)
    const datelessOnceSaved = releasedOn === null || (releasedOn === undefined && current.releasedOn === null)
    if (publishedAt && datelessOnceSaved) releasedOn = today()

    return this.prisma.improvement.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        summary: dto.summary?.trim(),
        beforeText: optionalText(dto.beforeText),
        afterText: optionalText(dto.afterText),
        example: optionalText(dto.example),
        area: dto.area,
        releasedOn,
        producerId: dto.producerId,
        publishedAt,
      },
      select: OWNER_SELECT,
    })
  }

  async remove(id: number): Promise<{ ok: true }> {
    await this.findOrThrow(id)
    await this.prisma.improvement.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  private async findOrThrow(id: number) {
    const improvement = await this.prisma.improvement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, publishedAt: true, releasedOn: true },
    })
    if (!improvement) throw new NotFoundException(`Improvement ${id} not found`)
    return improvement
  }

  private async assertOrganization(producerId: number | null | undefined): Promise<void> {
    if (producerId === null || producerId === undefined) return
    const org = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { id: true },
    })
    if (!org) throw new BadRequestException(`Organization ${producerId} not found`)
  }
}
