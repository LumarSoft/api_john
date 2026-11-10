import { isCancelledMovimiento } from '../common/poliza-vigencia'

/**
 * Whether the policy of a claim covered the day of the incident, for the
 * office: the panel shows it as a banner on the claim. It is computed on each
 * read from what the cartera sync holds now, so a policy Triunfo cancels after
 * the claim was filed — often back to the first unpaid installment — shows up
 * the next time the claim is opened.
 *
 * What each source is worth (measured on the cartera, 10/11/2026):
 * - Dates and cancellations are Triunfo's own facts: `danger`.
 * - Unpaid installments come from the twice-a-day sync, where a payment made
 *   the last few days may still read as pending (one policy in five has one):
 *   `warning`, for the office to confirm in Triunfo. They are never told to the
 *   customer (see paymentStatus in common/poliza-vigencia).
 */
export type CoverageLevel = 'ok' | 'warning' | 'danger'

export type CoverageIssueCode =
  /** Triunfo cancelled the policy and the cancellation was in effect on the day. */
  | 'CANCELLED'
  /** Cancelled today, but the cancellation takes effect after the day. */
  | 'CANCELLED_AFTER'
  | 'BEFORE_START'
  | 'AFTER_END'
  /** Outside this policy's term, inside the term of another policy of the same insured thing. */
  | 'OTHER_POLICY'
  | 'UNPAID_INSTALLMENTS'

export interface CoverageIssue {
  code: CoverageIssueCode
  level: 'warning' | 'danger'
  title: string
  detail: string
  /** The day the issue hinges on ("YYYY-MM-DD"): start or end of the term, the cancellation's first day, the oldest unpaid due date. */
  date: string | null
}

export interface ClaimCoverageCheck {
  level: CoverageLevel
  issues: CoverageIssue[]
}

export interface CoveragePolicy {
  certificateNumber: string
  endorsementNumber: number
  lastMovement: string
  validFrom: Date | null
  validTo: Date | null
  /** Triunfo's last novedad of the policy: `Vigencia` (months) and `VigenciaDesde` are read from it. */
  rawData: unknown
}

export interface CoverageInstallment {
  number: number
  dueDate: Date | null
  status: string
  providerStatus: string | null
}

export interface CoverageRejection {
  installmentNumber: number
  reason: string
}

export const COVERAGE_OK: ClaimCoverageCheck = { level: 'ok', issues: [] }

// Every date involved is a calendar day stored at midnight UTC.
const dayOf = (date: Date) => date.toISOString().slice(0, 10)
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`

const rawOf = (policy: CoveragePolicy): Record<string, unknown> =>
  policy.rawData && typeof policy.rawData === 'object' ? (policy.rawData as Record<string, unknown>) : {}

/** A real "YYYY-MM-DD" out of Triunfo's row; "0000-00-00" and blanks are no date. */
function rawDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !day.startsWith('0000') ? day : null
}

function monthsBefore(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 - months, 1))
  const lastDate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, lastDate))
  return dayOf(target)
}

/**
 * First and last day of the policy's term. `validTo` is the end of the term,
 * but `validFrom` is the start of the first novedad the sync ever stored: for
 * a policy loaded mid-term that is the start of a billing period (a
 * REFACTURACION), months after the policy began. Such a policy has a
 * suplemento above 0, and its start is the end minus Triunfo's `Vigencia` in
 * months — on the policies stored from their first movement the two agree in
 * 98% of the cartera. The earlier of both is kept, so an incident is only
 * called "before the start" when it is before either.
 */
export function policyTerm(policy: CoveragePolicy): { start: string | null; end: string | null } {
  const end = policy.validTo ? dayOf(policy.validTo) : null
  let start = policy.validFrom ? dayOf(policy.validFrom) : null
  const months = Number(rawOf(policy).Vigencia)
  if (end && policy.endorsementNumber > 0 && Number.isInteger(months) && months >= 1 && months <= 60) {
    const byTerm = monthsBefore(end, months)
    if (!start || byTerm < start) start = byTerm
  }
  return { start, end }
}

const CANCELLATION_REASONS: Array<[prefix: string, reason: string]> = [
  ['ANULA COBRANZA', 'por falta de pago'],
  ['ANULA POR VENTA', 'por venta del bien'],
  ['ANULA DESISTIM', 'por desistimiento del asegurado'],
  ['ANULA POR REEMPLAZO', 'por reemplazo de la póliza'],
  ['ANULA POR SINIESTRO', 'por un siniestro'],
  ['ANUL.P/CAMBIO DE CIA', 'por cambio de compañía'],
  ['RESCISION', 'por rescisión'],
]

/**
 * Triunfo's cancellation of the policy, if any: why, and from which day. The
 * cancelling novedad's `VigenciaDesde` is the day the cancellation takes
 * effect, not the day it was issued: for a policy cancelled over unpaid
 * installments ("ANULA COBRANZA") it is the due date of the first unpaid one
 * in 73% of the cartera, weeks before the cancellation was issued.
 */
export function cancellationOf(
  policy: CoveragePolicy,
): { movement: string; reason: string | null; since: string | null } | null {
  if (!isCancelledMovimiento(policy.lastMovement)) return null
  const movement = policy.lastMovement.trim().toUpperCase()
  const reason = CANCELLATION_REASONS.find(([prefix]) => movement.startsWith(prefix))?.[1] ?? null
  return { movement, reason, since: rawDay(rawOf(policy).VigenciaDesde) }
}

/** Where the day falls against the policy's term; both ends count as covered. */
export function termPosition(policy: CoveragePolicy, day: string): 'before' | 'inside' | 'after' {
  const { start, end } = policyTerm(policy)
  if (start && day < start) return 'before'
  if (end && day > end) return 'after'
  return 'inside'
}

/** In its term on that day and not cancelled by then. */
export function coveredOn(policy: CoveragePolicy, day: string): boolean {
  if (termPosition(policy, day) !== 'inside') return false
  const cancellation = cancellationOf(policy)
  return !cancellation || (cancellation.since !== null && day < cancellation.since)
}

/** Sent to the bank or card: neither paid nor unpaid until Triunfo says so. */
const isCollecting = (installment: CoverageInstallment) =>
  (installment.providerStatus ?? '').toUpperCase().startsWith('EN PRELIQ')

function unpaidIssue(
  installments: CoverageInstallment[],
  rejections: CoverageRejection[],
  incident: string,
): CoverageIssue | null {
  const unpaid = installments
    .filter(
      i =>
        (i.status === 'pending' || i.status === 'overdue') &&
        !isCollecting(i) &&
        i.dueDate !== null &&
        dayOf(i.dueDate) < incident,
    )
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
  if (unpaid.length === 0) return null

  const oldest = dayOf(unpaid[0].dueDate!)
  const numbers = unpaid.map(i => i.number)
  const which =
    unpaid.length === 1
      ? `La cuota ${numbers[0]} venció el ${formatDay(oldest)} y figura`
      : `Las cuotas ${numbers.slice(0, -1).join(', ')} y ${numbers.at(-1)} (la más vieja venció el ${formatDay(oldest)}) figuran`
  const rejected = rejections.find(r => numbers.includes(r.installmentNumber))
  return {
    code: 'UNPAID_INSTALLMENTS',
    level: 'warning',
    title:
      unpaid.length === 1
        ? '1 cuota impaga a la fecha del hecho'
        : `${unpaid.length} cuotas impagas a la fecha del hecho`,
    detail:
      `${which} sin pagar en la última sincronización con Triunfo.` +
      (rejected
        ? ` Triunfo informó el débito rechazado de la cuota ${rejected.installmentNumber} (${rejected.reason.trim()}).`
        : '') +
      ' Con cuotas vencidas la cobertura puede estar suspendida: confirmalo en Triunfo antes de gestionar el siniestro.',
    date: oldest,
  }
}

export function checkClaimCoverage(input: {
  occurredAt: Date
  policy: CoveragePolicy
  /** The policy's installments that are not paid (ANULADA ones left out). */
  installments?: CoverageInstallment[]
  /** Rejected debits Triunfo reported for the policy that were still unpaid. */
  rejections?: CoverageRejection[]
  /** Other policies of the same client and insured thing, to tell a renewal apart from no cover. */
  otherPolicies?: CoveragePolicy[]
}): ClaimCoverageCheck {
  const { policy } = input
  const incident = dayOf(input.occurredAt)
  const issues: CoverageIssue[] = []

  const cancellation = cancellationOf(policy)
  if (cancellation) {
    const why = cancellation.reason ? ` ${cancellation.reason}` : ''
    if (!cancellation.since) {
      issues.push({
        code: 'CANCELLED',
        level: 'danger',
        title: `Póliza anulada${why}`,
        detail: `Triunfo la anuló (${cancellation.movement}) y no informa desde qué día rige la anulación. Confirmá en Triunfo si el ${formatDay(incident)}, día del hecho, tenía cobertura.`,
        date: null,
      })
    } else if (incident >= cancellation.since) {
      issues.push({
        code: 'CANCELLED',
        level: 'danger',
        title: `Póliza anulada${why}`,
        detail: `Triunfo la anuló (${cancellation.movement}) con efecto desde el ${formatDay(cancellation.since)}. El hecho fue el ${formatDay(incident)}: ese día ya no tenía cobertura.`,
        date: cancellation.since,
      })
    } else {
      issues.push({
        code: 'CANCELLED_AFTER',
        level: 'warning',
        title: `Póliza anulada${why} después del hecho`,
        detail: `Triunfo la anuló (${cancellation.movement}) con efecto desde el ${formatDay(cancellation.since)}. El hecho fue el ${formatDay(incident)}, cuando seguía vigente: confirmá la cobertura en Triunfo.`,
        date: cancellation.since,
      })
    }
  }

  // A policy cancelled by then has one thing to say; its dates and installments add noise.
  if (!issues.some(issue => issue.code === 'CANCELLED')) {
    const position = termPosition(policy, incident)
    if (position !== 'inside') {
      const { start, end } = policyTerm(policy)
      const boundary = position === 'before' ? start! : end!
      const term = position === 'before' ? `rige desde el ${formatDay(boundary)}` : `venció el ${formatDay(boundary)}`
      const other = (input.otherPolicies ?? []).find(candidate => coveredOn(candidate, incident))
      issues.push(
        other
          ? {
              code: 'OTHER_POLICY',
              level: 'warning',
              title: 'El hecho corresponde a otra póliza',
              detail: `Esta póliza ${term} y el hecho fue el ${formatDay(incident)}. Ese día estaba vigente la póliza N° ${other.certificateNumber} del mismo asegurado: gestioná el siniestro con esa.`,
              date: boundary,
            }
          : {
              code: position === 'before' ? 'BEFORE_START' : 'AFTER_END',
              level: 'danger',
              title:
                position === 'before'
                  ? 'El hecho es anterior al inicio de la póliza'
                  : 'El hecho es posterior al vencimiento de la póliza',
              detail: `La póliza ${term} y el hecho fue el ${formatDay(incident)}: ese día el bien no estaba cubierto por esta póliza.`,
              date: boundary,
            },
      )
    } else if (!cancellation) {
      const unpaid = unpaidIssue(input.installments ?? [], input.rejections ?? [], incident)
      if (unpaid) issues.push(unpaid)
    }
  }

  const level: CoverageLevel = issues.some(i => i.level === 'danger') ? 'danger' : issues.length ? 'warning' : 'ok'
  return { level, issues }
}

/**
 * The one line the office reads where the claim is announced (the matter and
 * the e-mail). Only what Triunfo states as a fact: an unpaid installment may
 * be paid by the next sync, and those texts are written once.
 */
export function coverageAlert(check: ClaimCoverageCheck): string | null {
  const issue = check.issues.find(i => i.level === 'danger')
  return issue ? `${issue.title}. ${issue.detail}` : null
}

/**
 * Why a policy is not in force today, for the office: "N° 4401122 (AB123CD):
 * anulada por falta de pago (ANULA COBRANZA) desde el 20/01/2026". Null for a
 * policy in force.
 */
export function lapsedPolicyLine(
  policy: CoveragePolicy & { vehicle?: { licensePlate: string | null } | null },
  now: Date = new Date(),
): string | null {
  const today = dayOf(now)
  const plate = policy.vehicle?.licensePlate?.trim()
  const name = `N° ${policy.certificateNumber}${plate ? ` (${plate})` : ''}`
  const cancellation = cancellationOf(policy)
  if (cancellation) {
    const why = cancellation.reason ? ` ${cancellation.reason}` : ''
    const since = cancellation.since ? ` desde el ${formatDay(cancellation.since)}` : ''
    return `${name}: anulada${why} (${cancellation.movement})${since}`
  }
  if (policy.validTo && dayOf(policy.validTo) < today) return `${name}: vencida el ${formatDay(dayOf(policy.validTo))}`
  if (policy.validFrom && dayOf(policy.validFrom) > today)
    return `${name}: empieza a regir el ${formatDay(dayOf(policy.validFrom))}`
  return null
}
