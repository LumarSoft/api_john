import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { BUSINESS_TZ } from './schedule'

export const HOLIDAY_SOURCE = 'holiday'

const HOLIDAYS_URL = 'https://api.argentinadatos.com/v1/feriados'
// National holidays only. "puente" (días no laborables con fines turísticos) is
// optional for private employers, so it is opt-in through HOLIDAY_TYPES.
const DEFAULT_TYPES = ['inamovible', 'trasladable']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface Holiday {
  fecha: string
  tipo: string
  nombre: string
}

function isHoliday(value: unknown): value is Holiday {
  const h = value as Partial<Holiday> | null
  return (
    typeof h?.fecha === 'string' && DATE.test(h.fecha) && typeof h.tipo === 'string' && typeof h.nombre === 'string'
  )
}

/** Today in Argentina, YYYY-MM-DD. */
function todayInArgentina(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(now)
}

/**
 * Loads Argentina's national holidays as closures of every number of every
 * active organization (each branch closes on its own: one may open on a holiday),
 * so the bot says "hoy estamos cerrados" and promises the right reopening day
 * without anyone typing them in. The calendar comes from argentinadatos.com,
 * which mirrors the official one (argentina.gob.ar/feriados) and picks up new
 * decrees, like the 2026 papal visit.
 *
 * A holiday closure an admin deleted (that number opens that day) is still in
 * the table, so it is not created again for it. And an upcoming holiday that is no
 * longer in its year's calendar (the government moved it) is removed, but only
 * when that calendar was actually fetched.
 */
@Injectable()
export class HolidaySyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HolidaySyncService.name)
  private readonly enabled: boolean
  private readonly types: string[]

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('HOLIDAY_SYNC_ENABLED') !== 'false'
    const types = (config.get<string>('HOLIDAY_TYPES') ?? '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    this.types = types.length > 0 ? types : DEFAULT_TYPES
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return
    void this.sync().catch(error => this.logger.error(`Holiday sync failed: ${(error as Error).message}`))
  }

  // Daily: holidays are decreed weeks ahead, but a number connected today must
  // not wait a week for its own.
  @Cron('0 5 * * *', { timeZone: BUSINESS_TZ })
  async scheduledSync(): Promise<void> {
    if (!this.enabled) return
    await this.sync().catch(error => this.logger.error(`Holiday sync failed: ${(error as Error).message}`))
  }

  async sync(now: Date = new Date()): Promise<{ created: number; removed: number }> {
    const today = todayInArgentina(now)
    const year = Number(today.slice(0, 4))
    const years = [year, year + 1]
    const calendars = await Promise.all(years.map(y => this.fetchYear(y)))
    const fetchedYears = years.filter((_, i) => calendars[i] !== null)
    const holidays = calendars
      .flatMap(calendar => calendar ?? [])
      .filter(h => h.fecha >= today && this.types.includes(h.tipo))

    const numbers = await this.prisma.phoneNumber.findMany({
      where: { deletedAt: null, producer: { deletedAt: null, isActive: true } },
      select: { id: true, producerId: true },
    })
    if (numbers.length === 0 || fetchedYears.length === 0) return { created: 0, removed: 0 }

    const removed = await this.removeMoved(holidays, fetchedYears, today)

    // Deleted rows included on purpose: they are holidays a number chose to open on.
    const existing = await this.prisma.businessClosure.findMany({
      where: {
        source: HOLIDAY_SOURCE,
        phoneNumberId: { in: numbers.map(n => n.id) },
        startDate: { gte: new Date(`${today}T00:00:00Z`) },
      },
      select: { phoneNumberId: true, startDate: true },
    })
    const loaded = new Set(existing.map(c => `${c.phoneNumberId}|${c.startDate.toISOString().slice(0, 10)}`))

    const data = numbers.flatMap(number =>
      holidays
        .filter(h => !loaded.has(`${number.id}|${h.fecha}`))
        .map(h => ({
          producerId: number.producerId,
          phoneNumberId: number.id,
          startDate: new Date(`${h.fecha}T00:00:00Z`),
          endDate: new Date(`${h.fecha}T00:00:00Z`),
          reason: `feriado nacional: ${h.nombre}`.slice(0, 160),
          source: HOLIDAY_SOURCE,
        })),
    )
    if (data.length === 0) return { created: 0, removed }

    const { count } = await this.prisma.businessClosure.createMany({ data })
    this.logger.log(`Loaded ${count} national holiday closure(s) for ${numbers.length} number(s)`)
    return { created: count, removed }
  }

  /** Upcoming automatic closures of a fetched year whose date is no longer a holiday. */
  private async removeMoved(holidays: Holiday[], fetchedYears: number[], today: string): Promise<number> {
    const dates = new Set(holidays.map(h => h.fecha))
    const upcoming = await this.prisma.businessClosure.findMany({
      where: { source: HOLIDAY_SOURCE, deletedAt: null, startDate: { gte: new Date(`${today}T00:00:00Z`) } },
      select: { id: true, startDate: true, reason: true },
    })
    const stale = upcoming.filter(c => {
      const date = c.startDate.toISOString().slice(0, 10)
      return fetchedYears.includes(Number(date.slice(0, 4))) && !dates.has(date)
    })
    if (stale.length === 0) return 0

    await this.prisma.businessClosure.updateMany({
      where: { id: { in: stale.map(c => c.id) } },
      data: { deletedAt: new Date() },
    })
    this.logger.log(`Removed ${stale.length} holiday closure(s) no longer in the calendar`)
    return stale.length
  }

  /** A year's calendar, or null when it isn't published yet or the source is down. */
  private async fetchYear(year: number): Promise<Holiday[] | null> {
    try {
      const res = await fetch(`${HOLIDAYS_URL}/${year}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        this.logger.warn(`Holiday calendar ${year} unavailable (HTTP ${res.status})`)
        return null
      }
      const body: unknown = await res.json()
      const holidays = Array.isArray(body) ? body.filter(isHoliday) : []
      // An empty or unreadable answer is treated as unavailable, never as "no holidays".
      return holidays.length > 0 ? holidays : null
    } catch (error) {
      this.logger.warn(`Holiday calendar ${year} unavailable: ${(error as Error).message}`)
      return null
    }
  }
}
