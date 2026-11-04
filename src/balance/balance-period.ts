import { currentPeriod, nextPeriod, periodStart } from '../usage/usage.service'

/** The month before `period` ("2026-01" → "2025-12"). */
export function previousPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/** The last `count` closed months before `now`'s month, oldest first. */
export function closedPeriods(count: number, now: Date = new Date()): string[] {
  const periods: string[] = []
  let period = previousPeriod(currentPeriod(now))
  for (let i = 0; i < count; i++) {
    periods.unshift(period)
    period = previousPeriod(period)
  }
  return periods
}

/** True when `period` has ended by `now` (Argentina time). */
export function isClosedPeriod(period: string, now: Date = new Date()): boolean {
  return period < currentPeriod(now)
}

/**
 * The month as two ranges, both [from, to):
 * - `from`/`to` for timestamps (createdAt, sentAt): the month in Argentina.
 * - `dateFrom`/`dateTo` for Triunfo's date-only values (Policy.validFrom /
 *   validTo, stored at UTC midnight): the calendar days of the month.
 */
export function periodRanges(period: string) {
  const next = nextPeriod(period)
  return {
    from: periodStart(period),
    to: periodStart(next),
    dateFrom: new Date(`${period}-01T00:00:00Z`),
    dateTo: new Date(`${next}-01T00:00:00Z`),
  }
}
