import { BadRequestException } from '@nestjs/common'

/**
 * Weekly business hours and the pure logic to format them and decide whether the
 * office is open "now". Time zone is fixed to Argentina; everything here is
 * deterministic so the WhatsApp bot can answer hour questions without the LLM.
 */

export const BUSINESS_TZ = 'America/Argentina/Buenos_Aires'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** A single HH:mm–HH:mm opening range (24h). */
export interface TimeRange {
  from: string
  to: string
}

/** Per-day ranges. An empty array means closed that day. */
export type WeeklySchedule = Record<Weekday, TimeRange[]>

export interface ActiveClosure {
  reason: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

export interface HoursStatus {
  /** Human-readable weekly schedule, e.g. "Lunes a viernes de 9 a 12 y de 17 a 19:30 hs". */
  formatted: string
  isOpenNow: boolean
  /** Closure covering today, if any (holiday/vacation). */
  todayClosure: { reason: string } | null
  /** Full natural-language answer for "¿qué horario tienen? / ¿están abiertos?". */
  message: string
  /** Short note to append when the bot promises human contact while closed. */
  closedNote: string | null
}

const DAY_NAME: Record<Weekday, string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
}

/** Default schedule: Monday–Friday 08:00–16:00, weekend closed. */
export const DEFAULT_SCHEDULE: WeeklySchedule = {
  mon: [{ from: '08:00', to: '16:00' }],
  tue: [{ from: '08:00', to: '16:00' }],
  wed: [{ from: '08:00', to: '16:00' }],
  thu: [{ from: '08:00', to: '16:00' }],
  fri: [{ from: '08:00', to: '16:00' }],
  sat: [],
  sun: [],
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Validates and normalises a raw schedule, throwing on any malformed input. */
export function validateSchedule(input: unknown): WeeklySchedule {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('businessHours must be an object')
  }
  const raw = input as Record<string, unknown>
  const result = {} as WeeklySchedule

  for (const day of WEEKDAYS) {
    const ranges = raw[day]
    if (ranges === undefined) {
      result[day] = []
      continue
    }
    if (!Array.isArray(ranges)) {
      throw new BadRequestException(`businessHours.${day} must be an array`)
    }
    const parsed: TimeRange[] = ranges.map(r => {
      const range = r as { from?: unknown; to?: unknown }
      if (
        typeof range.from !== 'string' ||
        typeof range.to !== 'string' ||
        !HHMM.test(range.from) ||
        !HHMM.test(range.to)
      ) {
        throw new BadRequestException(`businessHours.${day} has an invalid HH:mm range`)
      }
      if (toMinutes(range.from) >= toMinutes(range.to)) {
        throw new BadRequestException(`businessHours.${day}: "from" must be before "to"`)
      }
      return { from: range.from, to: range.to }
    })
    parsed.sort((a, b) => toMinutes(a.from) - toMinutes(b.from))
    // Reject overlapping ranges so the schedule stays unambiguous.
    for (let i = 1; i < parsed.length; i++) {
      if (toMinutes(parsed[i].from) < toMinutes(parsed[i - 1].to)) {
        throw new BadRequestException(`businessHours.${day} has overlapping ranges`)
      }
    }
    result[day] = parsed
  }
  return result
}

/** Coerces a stored JSON value into a schedule, falling back to the default. */
export function parseSchedule(value: unknown): WeeklySchedule {
  try {
    return validateSchedule(value)
  } catch {
    return DEFAULT_SCHEDULE
  }
}

const fmtTime = (t: string): string => {
  const [h, m] = t.split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}

const fmtRanges = (ranges: TimeRange[]): string =>
  ranges.map(r => `de ${fmtTime(r.from)} a ${fmtTime(r.to)}`).join(' y ') + ' hs'

const sig = (ranges: TimeRange[]): string => ranges.map(r => `${r.from}-${r.to}`).join(',')

/** Groups consecutive days with identical hours into one human-readable line. */
export function formatSchedule(weekly: WeeklySchedule): string {
  const groups: string[] = []
  let i = 0
  while (i < WEEKDAYS.length) {
    const day = WEEKDAYS[i]
    const ranges = weekly[day]
    if (ranges.length === 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < WEEKDAYS.length && sig(weekly[WEEKDAYS[j + 1]]) === sig(ranges)) j++
    const label = j > i ? `${DAY_NAME[WEEKDAYS[i]]} a ${DAY_NAME[WEEKDAYS[j]].toLowerCase()}` : DAY_NAME[day]
    groups.push(`${label} ${fmtRanges(ranges)}`)
    i = j + 1
  }
  return groups.length > 0 ? groups.join(' · ') : 'Sin horario de atención cargado'
}

/** Date/time parts for "now" in Argentina, used for the open-now calculation. */
function nowParts(now: Date): { date: string; weekday: Weekday; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const wdMap: Record<string, Weekday> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
  }
  const hour = get('hour') === '24' ? 0 : Number(get('hour'))
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: wdMap[get('weekday')],
    minutes: hour * 60 + Number(get('minute')),
  }
}

/** Adds `days` to a YYYY-MM-DD string (UTC-safe) and returns the new parts. */
function addDays(dateStr: string, days: number): { date: string; weekday: Weekday } {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  const date = d.toISOString().slice(0, 10)
  const wd: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return { date, weekday: wd[d.getUTCDay()] }
}

const closureFor = (closures: ActiveClosure[], date: string): ActiveClosure | null =>
  closures.find(c => date >= c.startDate && date <= c.endDate) ?? null

/** Earliest opening at or after "now", as a relative phrase, or null within 7 days. */
function nextOpening(
  weekly: WeeklySchedule,
  closures: ActiveClosure[],
  today: string,
  nowMinutes: number,
): string | null {
  for (let offset = 0; offset <= 7; offset++) {
    const { date, weekday } = addDays(today, offset)
    if (closureFor(closures, date)) continue
    for (const r of weekly[weekday]) {
      // Today only counts ranges that have not started yet.
      if (offset > 0 || toMinutes(r.from) > nowMinutes) {
        const when = offset === 0 ? 'hoy' : offset === 1 ? 'mañana' : `el ${DAY_NAME[weekday].toLowerCase()}`
        return `${when} a las ${fmtTime(r.from)} hs`
      }
    }
  }
  return null
}

/**
 * Computes everything the bot/web need to talk about hours: the formatted week,
 * whether it is open right now (honoring closures), and ready-to-send copy.
 */
export function computeStatus(weekly: WeeklySchedule, closures: ActiveClosure[], now: Date = new Date()): HoursStatus {
  const formatted = formatSchedule(weekly)
  const { date, weekday, minutes } = nowParts(now)

  const closure = closureFor(closures, date)
  const openBySchedule = weekly[weekday].some(r => minutes >= toMinutes(r.from) && minutes < toMinutes(r.to))
  const isOpenNow = !closure && openBySchedule

  const next = nextOpening(weekly, closures, date, minutes)
  const nextPhrase = next ? ` Volvemos a atender ${next}.` : ''

  let message: string
  let closedNote: string | null
  if (isOpenNow) {
    message = `Sí, ahora estamos abiertos 🙂. Nuestro horario es: ${formatted}.`
    closedNote = null
  } else if (closure) {
    message = `Hoy estamos cerrados por *${closure.reason}*. Nuestro horario habitual es: ${formatted}.${nextPhrase}`
    closedNote = `_Hoy estamos cerrados por ${closure.reason}; te respondemos al reabrir${next ? ` (${next})` : ''}._`
  } else {
    message = `Ahora estamos fuera de horario. Nuestro horario es: ${formatted}.${nextPhrase}`
    closedNote = `_Ahora estamos fuera de horario; te respondemos al reabrir${next ? ` (${next})` : ''}._`
  }

  return { formatted, isOpenNow, todayClosure: closure ? { reason: closure.reason } : null, message, closedNote }
}
