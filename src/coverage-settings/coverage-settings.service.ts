import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateCoverageSettingDto } from './dto/update-coverage-setting.dto'
import { ReorderCoverageSettingsDto } from './dto/reorder-coverage-settings.dto'
import { defaultCopyFor } from './coverage-defaults'

const SETTING_SELECT = {
  id: true,
  code: true,
  name: true,
  tagline: true,
  benefits: true,
  isActive: true,
  isConfigured: true,
  highlighted: true,
  sortOrder: true,
  yearFrom: true,
  yearTo: true,
  firstSeenAt: true,
} as const

type SettingRow = Prisma.CoverageSettingGetPayload<{ select: typeof SETTING_SELECT }>

/** A coverage as it comes out of the Triunfo quote, before the display rules. */
export interface QuotedCoverage {
  code: string
}

/** The display attributes the quote response carries for each coverage. */
export interface CoverageDisplay {
  name: string
  tagline: string | null
  benefits: string[]
  highlighted: boolean
}

@Injectable()
export class CoverageSettingsService {
  private readonly logger = new Logger(CoverageSettingsService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ─── Admin ─────────────────────────────────────────────────

  async listForAdmin(producerId: number) {
    const settings = await this.prisma.coverageSetting.findMany({
      where: { producerId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: SETTING_SELECT,
    })
    return settings.map(s => this.toResponse(s))
  }

  async update(producerId: number, id: number, dto: UpdateCoverageSettingDto) {
    await this.requireSetting(producerId, id)

    const setting = await this.prisma.coverageSetting.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
        ...(dto.benefits !== undefined ? { benefits: dto.benefits as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.highlighted !== undefined ? { highlighted: dto.highlighted } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.yearFrom !== undefined ? { yearFrom: dto.yearFrom } : {}),
        ...(dto.yearTo !== undefined ? { yearTo: dto.yearTo } : {}),
        // Any edit means a human has reviewed this code.
        isConfigured: true,
      },
      select: SETTING_SELECT,
    })
    return this.toResponse(setting)
  }

  /** Bulk ordering, so the admin screen can persist a drag-and-drop list in one call. */
  async reorder(producerId: number, dto: ReorderCoverageSettingsDto) {
    const ids = dto.items.map(i => i.id)
    const owned = await this.prisma.coverageSetting.findMany({
      where: { id: { in: ids }, producerId, deletedAt: null },
      select: { id: true },
    })
    if (owned.length !== ids.length) {
      throw new NotFoundException('Alguna de las coberturas no existe')
    }

    await this.prisma.$transaction(
      dto.items.map(item =>
        this.prisma.coverageSetting.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    )
    return this.listForAdmin(producerId)
  }

  // ─── Quote pipeline ────────────────────────────────────────

  /**
   * Applies the display rules to the coverages Triunfo quoted: drops the ones
   * turned off (or outside their year window), sorts by the configured order and
   * attaches the commercial wording.
   *
   * A code with no row yet passes through with its default copy. Hiding an
   * unknown coverage would silently remove an offer the broker never chose to
   * remove — better to show it and let the admin screen flag it as unconfigured.
   */
  async apply<T extends QuotedCoverage>(
    producerId: number,
    coverages: T[],
    vehicleYear: number,
  ): Promise<Array<T & CoverageDisplay>> {
    if (coverages.length === 0) return []

    const settings = await this.prisma.coverageSetting.findMany({
      where: { producerId, code: { in: coverages.map(c => c.code) }, deletedAt: null },
      select: SETTING_SELECT,
    })
    const byCode = new Map(settings.map(s => [s.code, s]))

    return coverages
      .filter(c => {
        const setting = byCode.get(c.code)
        if (!setting) return true // unknown code — show it
        if (!setting.isActive) return false
        if (setting.yearFrom !== null && vehicleYear < setting.yearFrom) return false
        if (setting.yearTo !== null && vehicleYear > setting.yearTo) return false
        return true
      })
      .map(c => {
        const setting = byCode.get(c.code)
        const fallback = defaultCopyFor(c.code)
        return {
          ...c,
          name: setting?.name ?? fallback.name,
          tagline: setting?.tagline ?? (fallback.tagline || null),
          benefits: setting ? this.readBenefits(setting.benefits) : fallback.benefits,
          highlighted: setting?.highlighted ?? false,
          _order: setting?.sortOrder ?? fallback.sortOrder,
        }
      })
      .sort((a, b) => a._order - b._order)
      .map(({ _order, ...coverage }) => coverage as T & CoverageDisplay)
  }

  /**
   * Registers coverage codes seen in a quote so the admin screen can list real
   * codes. Fire-and-forget from the quote path: a failure here must never cost a
   * quote, and the code will be picked up on the next one anyway.
   */
  async registerDiscovered(producerId: number, codes: string[]): Promise<void> {
    const unique = [...new Set(codes.map(c => c.trim()).filter(Boolean))]
    if (unique.length === 0) return

    const known = await this.prisma.coverageSetting.findMany({
      where: { producerId, code: { in: unique } },
      select: { code: true, deletedAt: true, id: true },
    })
    const knownByCode = new Map(known.map(k => [k.code, k]))

    for (const code of unique) {
      const existing = knownByCode.get(code)

      // Already registered and live — nothing to do.
      if (existing && existing.deletedAt === null) continue

      try {
        if (existing) {
          // Was soft-deleted and Triunfo is quoting it again: revive it rather
          // than hitting the (producerId, code) unique constraint.
          await this.prisma.coverageSetting.update({ where: { id: existing.id }, data: { deletedAt: null } })
          continue
        }

        const copy = defaultCopyFor(code)
        await this.prisma.coverageSetting.create({
          data: {
            producerId,
            code,
            name: copy.name,
            tagline: copy.tagline || null,
            benefits: copy.benefits as unknown as Prisma.InputJsonValue,
            sortOrder: copy.sortOrder,
            isActive: true,
            isConfigured: false,
          },
        })
        this.logger.log(`Cobertura nueva detectada: ${code} (productor ${producerId})`)
      } catch (error) {
        // Two concurrent quotes can race on the same new code; the unique
        // constraint is the arbiter and the loser has nothing left to do.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue
        throw error
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private async requireSetting(producerId: number, id: number) {
    const setting = await this.prisma.coverageSetting.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true },
    })
    if (!setting) throw new NotFoundException(`Cobertura ${id} no encontrada`)
    return setting
  }

  private readBenefits(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((b): b is string => typeof b === 'string') : []
  }

  private toResponse(setting: SettingRow) {
    return {
      id: setting.id,
      code: setting.code,
      name: setting.name,
      tagline: setting.tagline,
      benefits: this.readBenefits(setting.benefits),
      isActive: setting.isActive,
      isConfigured: setting.isConfigured,
      highlighted: setting.highlighted,
      sortOrder: setting.sortOrder,
      yearFrom: setting.yearFrom,
      yearTo: setting.yearTo,
      firstSeenAt: setting.firstSeenAt,
    }
  }
}
