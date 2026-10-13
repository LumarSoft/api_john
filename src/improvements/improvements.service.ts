import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ImprovementArea, Prisma } from 'generated/prisma/client'
import { Page, pageWindow, toPage } from '../common/pagination'
import { PrismaService } from '../prisma/prisma.service'
import { CreateImprovementDto, UpdateImprovementDto } from './dto/improvement.dto'
import { ListImprovementsDto, ListOwnerImprovementsDto, OwnerImprovementFilter } from './dto/list-improvements.dto'

export const IMPROVEMENTS_PAGE_SIZE = 10

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

/** A page of published improvements plus how many there are per area (ignoring the area filter), for the chips. */
export interface ImprovementsPage extends Page<ImprovementView> {
  areaCounts: Record<ImprovementArea, number>
}

/** The editor's page plus the size of each status list (ignoring the status filter), for the chips. */
export interface OwnerImprovementsPage extends Page<OwnerImprovementView> {
  counts: { all: number; drafts: number; published: number }
}

type OwnerImprovementView = Prisma.ImprovementGetPayload<{ select: typeof OWNER_SELECT }>

const PUBLIC_ORDER: Prisma.ImprovementOrderByWithRelationInput[] = [
  // By the date of the change: an older improvement published today stays in its place.
  { releasedOn: 'desc' },
  { publishedAt: 'desc' },
  { id: 'desc' },
]

// Same order the organizations read them in, drafts without a date first.
const OWNER_ORDER: Prisma.ImprovementOrderByWithRelationInput[] = [
  { releasedOn: { sort: 'desc', nulls: 'first' } },
  { id: 'desc' },
]

const OWNER_FILTER_WHERE: Record<OwnerImprovementFilter, Prisma.ImprovementWhereInput> = {
  all: {},
  drafts: { publishedAt: null },
  published: { publishedAt: { not: null } },
}

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

  /**
   * Published improvements for the caller's organization. With `page` it answers one
   * page (optionally of one area); without it, the full array the panel read before paginating.
   */
  async listPublished(
    producerId: number,
    query: ListImprovementsDto = {},
  ): Promise<ImprovementView[] | ImprovementsPage> {
    const visible = this.visibleTo(producerId)
    if (query.page === undefined) {
      return this.prisma.improvement.findMany({ where: visible, orderBy: PUBLIC_ORDER, select: PUBLIC_SELECT })
    }

    const { page, pageSize, skip, take } = pageWindow(query, IMPROVEMENTS_PAGE_SIZE)
    const where: Prisma.ImprovementWhereInput = query.area ? { ...visible, area: query.area } : visible
    const [total, data, byArea] = await Promise.all([
      this.prisma.improvement.count({ where }),
      this.prisma.improvement.findMany({ where, orderBy: PUBLIC_ORDER, select: PUBLIC_SELECT, skip, take }),
      this.prisma.improvement.groupBy({ by: ['area'], where: visible, _count: { _all: true } }),
    ])
    const areaCounts = Object.fromEntries(Object.values(ImprovementArea).map(area => [area, 0])) as Record<
      ImprovementArea,
      number
    >
    for (const row of byArea) areaCounts[row.area] = row._count._all
    return { ...toPage(data, total, page, pageSize), areaCounts }
  }

  /** What counts as new for a user: published after their last visit (everything before the first one). */
  private unseenWhere(producerId: number, lastVisit: Date | null): Prisma.ImprovementWhereInput {
    const where = this.visibleTo(producerId)
    return lastVisit ? { ...where, publishedAt: { not: null, gt: lastVisit } } : where
  }

  /** Published improvements this user hasn't seen yet (all of them before their first visit). */
  async countUnseen(userId: number, producerId: number): Promise<{ count: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastImprovementsVisitAt: true },
    })
    const count = await this.prisma.improvement.count({
      where: this.unseenWhere(producerId, user.lastImprovementsVisitAt),
    })
    return { count }
  }

  /**
   * Marks "Mejoras" as seen now and returns the previous visit, so the page can
   * still badge as new what was published since then, plus how many those are
   * (the page only holds one page of the list, so it can't count them itself).
   */
  async registerVisit(
    userId: number,
    producerId: number,
  ): Promise<{ previousVisitAt: Date | null; visitedAt: Date; newCount: number }> {
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lastImprovementsVisitAt: true },
      })
      const newCount = await tx.improvement.count({ where: this.unseenWhere(producerId, user.lastImprovementsVisitAt) })
      const visitedAt = new Date()
      await tx.user.update({ where: { id: userId }, data: { lastImprovementsVisitAt: visitedAt } })
      return { previousVisitAt: user.lastImprovementsVisitAt, visitedAt, newCount }
    })
  }

  // ── OWNER (Lumar) ─────────────────────────────────────

  /**
   * Every improvement, drafts included. With `page` it answers one page of the
   * chosen status list; without it, the full array the editor read before paginating.
   */
  async listAll(query: ListOwnerImprovementsDto = {}): Promise<OwnerImprovementView[] | OwnerImprovementsPage> {
    const base: Prisma.ImprovementWhereInput = { deletedAt: null }
    if (query.page === undefined) {
      return this.prisma.improvement.findMany({ where: base, orderBy: OWNER_ORDER, select: OWNER_SELECT })
    }

    const { page, pageSize, skip, take } = pageWindow(query, IMPROVEMENTS_PAGE_SIZE)
    const where = { ...base, ...OWNER_FILTER_WHERE[query.filter ?? 'all'] }
    const [total, data, drafts, published] = await Promise.all([
      this.prisma.improvement.count({ where }),
      this.prisma.improvement.findMany({ where, orderBy: OWNER_ORDER, select: OWNER_SELECT, skip, take }),
      this.prisma.improvement.count({ where: { ...base, ...OWNER_FILTER_WHERE.drafts } }),
      this.prisma.improvement.count({ where: { ...base, ...OWNER_FILTER_WHERE.published } }),
    ])
    return { ...toPage(data, total, page, pageSize), counts: { all: drafts + published, drafts, published } }
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
