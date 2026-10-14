/**
 * When the installment after the latest one billed is due. Triunfo bills a few
 * installments at a time (and numbers each batch from 1), so with everything
 * paid the next one is not in the cartera yet — nor in the customer's app.
 *
 * Estimated from the policy's own cadence: the months between its two latest
 * due dates (almost always one), or one month when there is a single one. Null
 * when there is nothing to go by or the next one would fall past the policy's
 * end.
 */
export function estimateNextDueDate(dueDates: Array<Date | null>, validTo: Date | null): Date | null {
  const dates = dueDates
    .filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())
  const last = dates[dates.length - 1]
  if (!last) return null

  const prev = dates[dates.length - 2]
  const gap = prev ? (last.getUTCFullYear() - prev.getUTCFullYear()) * 12 + last.getUTCMonth() - prev.getUTCMonth() : 1
  const months = gap >= 1 && gap <= 6 ? gap : 1

  // Same day of the month, clamped (31/01 + 1 month = 28/02). Due dates are
  // calendar days stored at UTC midnight.
  const year = last.getUTCFullYear()
  const month = last.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const next = new Date(Date.UTC(year, month, Math.min(last.getUTCDate(), lastDay)))

  return validTo && next >= validTo ? null : next
}
