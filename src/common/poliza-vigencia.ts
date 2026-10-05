import type { Prisma } from 'generated/prisma/client'
import { BUSINESS_TZ } from '../business-hours/schedule'

/**
 * `Poliza.status` is Triunfo's last movement type ("REFACTURACION",
 * "RENOVACION", "ANULA POR VENTA", …), not a validity flag, and a cancelled
 * policy keeps its original `vigenciaHasta`. So "in force" has to combine the
 * dates with the movement: over 2,000 cancelled policies had an end date in the
 * future and were counted — and shown in the bot — as current.
 *
 * Movements that end a policy start with one of these prefixes ("ANULA POR
 * VENTA", "ANUL.P/CAMBIO DE CIA", "RESCISION UNILATERAL"). "ENDOSO ANULA
 * ENDOSO" cancels an endorsement, not the policy, and is not matched.
 */
const CANCELLED_PREFIXES = ['ANUL', 'RESCISION'] as const

export type EstadoVigencia = 'vigente' | 'proxima' | 'vencida' | 'anulada'

export function isCancelledStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toUpperCase()
  return CANCELLED_PREFIXES.some(prefix => s.startsWith(prefix))
}

/**
 * Where-clause for policies covering *now*: started, not ended, not cancelled.
 * A renewal that starts next week is not in force yet — the policy it replaces
 * still is, and it is the one a claim filed today belongs to.
 */
export function inForcePolizaWhere(now: Date = new Date()): Prisma.PolizaWhereInput {
  return {
    deletedAt: null,
    vigenciaHasta: { gte: now },
    OR: [{ vigenciaDesde: null }, { vigenciaDesde: { lte: now } }],
    NOT: CANCELLED_PREFIXES.map(prefix => ({ status: { startsWith: prefix } })),
  }
}

/** Where-clause for policies in force now that end within `until`. */
export function expiringPolizaWhere(until: Date, now: Date = new Date()): Prisma.PolizaWhereInput {
  return { AND: [inForcePolizaWhere(now), { vigenciaHasta: { lte: until } }] }
}

export function estadoVigencia(
  poliza: { status: string | null; vigenciaDesde: Date | null; vigenciaHasta: Date | null },
  now: Date = new Date(),
): EstadoVigencia {
  if (isCancelledStatus(poliza.status)) return 'anulada'
  if (poliza.vigenciaDesde && poliza.vigenciaDesde > now) return 'proxima'
  if (poliza.vigenciaHasta && poliza.vigenciaHasta < now) return 'vencida'
  return 'vigente'
}

export interface EstadoPago {
  /** No rejected installment and none past due — the policy is paid up. */
  alDia: boolean
  cuotasRechazadas: number
  cuotasVencidas: number
}

/**
 * Not used to gate anything yet: in production 64% of the policies in force
 * have installments synced as overdue (mostly automatic debits), which points
 * at the sync's status mapping rather than real debt. Wire it back into claims
 * once `Cuota.status` is trustworthy.
 *
 * Payment standing of a policy from its installments. Triunfo keeps a policy
 * "in force" for a while after a rejected debit or a missed payment, but the
 * company won't cover a claim on it, so a claim has to check this too.
 *
 * Due dates are date-only values stored at UTC midnight, which in Argentina is
 * 21:00 of the previous day, so they are compared by calendar day against
 * today in Argentina: an installment is past due from the day after its due
 * date. The sync-time "overdue" status is not trusted on its own for the same
 * reason (it flips on the due date itself), and a "pending" one whose due date
 * has since passed counts too — a sync gap must not hide a debt.
 */
export function estadoPago(
  cuotas: Array<{ status: string; dueDate: Date | null }>,
  now: Date = new Date(),
): EstadoPago {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(now)
  const isPastDue = (cuota: { status: string; dueDate: Date | null }) => {
    if (cuota.status !== 'overdue' && cuota.status !== 'pending') return false
    if (!cuota.dueDate) return cuota.status === 'overdue'
    return cuota.dueDate.toISOString().slice(0, 10) < today
  }
  const cuotasRechazadas = cuotas.filter(c => c.status === 'rejected').length
  const cuotasVencidas = cuotas.filter(isPastDue).length
  return { alDia: cuotasRechazadas === 0 && cuotasVencidas === 0, cuotasRechazadas, cuotasVencidas }
}
