import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateCoverageSettingDto } from './dto/update-coverage-setting.dto'
import { ReorderCoverageSettingsDto } from './dto/reorder-coverage-settings.dto'
import { defaultCopyFor, motoCopyFor } from './coverage-defaults'
import { VehicleType } from '../infoauto/infoauto.types'

const SETTING_SELECT = {
  id: true,
  code: true,
  name: true,
  tagline: true,
  benefits: true,
  exclusions: true,
  isActive: true,
  isConfigured: true,
  highlighted: true,
  sortOrder: true,
  yearFrom: true,
  yearTo: true,
  highlightYearFrom: true,
  highlightYearTo: true,
  firstSeenAt: true,
} as const

const inYearRange = (year: number, from: number | null, to: number | null): boolean =>
  (from === null || year >= from) && (to === null || year <= to)

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
  exclusions: string[]
  highlighted: boolean
}

/** The client-facing wording of a coverage, wherever it comes from. */
type CoverageWording = Pick<CoverageDisplay, 'name' | 'tagline' | 'benefits' | 'exclusions'>

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
    const existing = await this.requireSetting(producerId, id)
    // An unconfigured row shows the default wording, not what was stored when it
    // was discovered. The first edit (even just a visibility toggle) saves that
    // wording, so the coverage keeps reading exactly as the admin saw it.
    const shown = existing.isConfigured ? null : this.defaultWording(existing.code)

    const setting = await this.prisma.coverageSetting.update({
      where: { id },
      data: {
        ...(shown
          ? {
              name: shown.name,
              tagline: shown.tagline,
              benefits: shown.benefits as unknown as Prisma.InputJsonValue,
              exclusions: shown.exclusions as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
        ...(dto.benefits !== undefined ? { benefits: dto.benefits as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.exclusions !== undefined ? { exclusions: dto.exclusions as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.highlighted !== undefined ? { highlighted: dto.highlighted } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.yearFrom !== undefined ? { yearFrom: dto.yearFrom } : {}),
        ...(dto.yearTo !== undefined ? { yearTo: dto.yearTo } : {}),
        ...(dto.highlightYearFrom !== undefined ? { highlightYearFrom: dto.highlightYearFrom } : {}),
        ...(dto.highlightYearTo !== undefined ? { highlightYearTo: dto.highlightYearTo } : {}),
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
   * turned off (or outside their year window), puts the recommended ones for
   * this vehicle year first ("La más elegida", optionally limited to a year
   * range — what suits a 2015 car is not what suits a 2024 one), then the
   * configured order, and attaches the commercial wording.
   *
   * A car coverage is only offered when its wording says what it includes:
   * the office-confirmed default copy or an admin's own benefits. A code with
   * neither is hidden — describing it by its letter promised destrucción total
   * on coverages that do not have it — and the admin screen flags it for review.
   */
  async apply<T extends QuotedCoverage>(
    producerId: number,
    coverages: T[],
    vehicleYear: number,
    requiredCodes: readonly string[] = [],
    vehicleType: VehicleType = VehicleType.AUTO,
  ): Promise<Array<T & CoverageDisplay>> {
    if (coverages.length === 0) return []

    // Motorcycles share Triunfo's letter codes with cars but not the products:
    // the admin screen configures car wording, so a moto quote always uses the
    // fixed moto catalog (names, benefits, order) and no car highlight.
    if (vehicleType === VehicleType.MOTO) {
      return coverages
        .map(c => ({ c, copy: motoCopyFor(c.code) }))
        .sort((a, b) => a.copy.sortOrder - b.copy.sortOrder)
        .map(
          ({ c, copy }) =>
            ({
              ...c,
              name: copy.name,
              tagline: copy.tagline || null,
              benefits: copy.benefits,
              exclusions: copy.exclusions,
              highlighted: false,
            }) as T & CoverageDisplay,
        )
    }

    const settings = await this.prisma.coverageSetting.findMany({
      where: { producerId, code: { in: coverages.map(c => c.code) }, deletedAt: null },
      select: SETTING_SELECT,
    })
    const byCode = new Map(settings.map(s => [s.code, s]))

    return coverages
      .filter(c => {
        if (requiredCodes.includes(c.code)) return true
        const setting = byCode.get(c.code)
        // Nobody wrote what it includes (an unconfirmed code, or one made visible
        // without text): offering it would mean guessing.
        const wording = setting ? this.wordingOf(setting) : this.defaultWording(c.code)
        if (wording.benefits.length === 0) return false
        if (!setting) return true
        if (!setting.isActive) return false
        return inYearRange(vehicleYear, setting.yearFrom, setting.yearTo)
      })
      .map(c => {
        const setting = byCode.get(c.code)
        return {
          ...c,
          ...(setting ? this.wordingOf(setting) : this.defaultWording(c.code)),
          highlighted:
            !!setting?.highlighted && inYearRange(vehicleYear, setting.highlightYearFrom, setting.highlightYearTo),
          _order: setting?.sortOrder ?? defaultCopyFor(c.code).sortOrder,
        }
      })
      .sort((a, b) => Number(b.highlighted) - Number(a.highlighted) || a._order - b._order)
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
            exclusions: copy.exclusions as unknown as Prisma.InputJsonValue,
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
      select: { id: true, code: true, isConfigured: true },
    })
    if (!setting) throw new NotFoundException(`Cobertura ${id} no encontrada`)
    return setting
  }

  private readList(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((b): b is string => typeof b === 'string') : []
  }

  private defaultWording(code: string): CoverageWording {
    const copy = defaultCopyFor(code)
    return { name: copy.name, tagline: copy.tagline || null, benefits: copy.benefits, exclusions: copy.exclusions }
  }

  /**
   * What a row reads like to the client. Until someone edits it, a row has no
   * wording of its own: what was stored when the code was discovered may predate
   * the confirmed copy, so it follows the current default instead.
   */
  private wordingOf(setting: SettingRow): CoverageWording {
    if (!setting.isConfigured) return this.defaultWording(setting.code)
    return {
      name: setting.name,
      tagline: setting.tagline,
      benefits: this.readList(setting.benefits),
      // Rows configured before exclusions existed keep the code's default list.
      exclusions:
        setting.exclusions == null ? defaultCopyFor(setting.code).exclusions : this.readList(setting.exclusions),
    }
  }

  private toResponse(setting: SettingRow) {
    return {
      id: setting.id,
      code: setting.code,
      ...this.wordingOf(setting),
      // Hidden from quotes until someone writes what it covers.
      needsReview: this.wordingOf(setting).benefits.length === 0,
      isActive: setting.isActive,
      isConfigured: setting.isConfigured,
      highlighted: setting.highlighted,
      sortOrder: setting.sortOrder,
      yearFrom: setting.yearFrom,
      yearTo: setting.yearTo,
      highlightYearFrom: setting.highlightYearFrom,
      highlightYearTo: setting.highlightYearTo,
      firstSeenAt: setting.firstSeenAt,
    }
  }
}
