import { isVisiblePaymentMethod } from '../common/payment-methods'
import { defaultCopyFor, motoCopyFor } from '../coverage-settings/coverage-defaults'
import type { CoverageGap } from './campaign-catalog'

/** The protections Mejora de coberturas looks for, by how the product manual words them. */
const CAR_PROTECTIONS: Array<{ gap: CoverageGap; has: RegExp }> = [
  { gap: 'robo', has: /robo/i },
  { gap: 'granizo', has: /granizo/i },
  { gap: 'cristales', has: /cristal/i },
]

/**
 * What a vehicle's coverage leaves out, read from Triunfo's product manual
 * (coverage-defaults.ts). A code the manual does not describe claims nothing: a
 * guessed gap would offer the client something they may already have. Motorbike
 * products have no hail or glass cover to add, so only theft counts for them.
 */
export function coverageGaps(code: string | null | undefined, isMoto: boolean): CoverageGap[] {
  if (!code?.trim()) return []
  const copy = isMoto ? motoCopyFor(code) : defaultCopyFor(code)
  if (!copy.benefits.length) return []
  const benefits = copy.benefits.join(' · ')
  return CAR_PROTECTIONS.filter(p => (!isMoto || p.gap === 'robo') && !p.has.test(benefits)).map(p => p.gap)
}

/**
 * How much a car coverage protects, to tell an upgrade from a sideways move:
 * A < the B family (total losses) < the C family (partial theft and fire, then
 * its add-ons) < the D family (todo riesgo). "C2 Full" is how Triunfo's cartera
 * writes the C7 of its quotes.
 */
const CAR_RANK: Record<string, number> = {
  A: 10,
  B4: 20,
  B0: 21,
  B1: 22,
  B3: 23,
  B: 24,
  C1: 30,
  C: 31,
  C2: 32,
  C8: 33,
  'C2 FULL': 34,
  C7: 34,
  D4: 40,
  D3: 41,
  D2: 42,
  D: 43,
}
const CAR_FAMILY_RANK: Record<string, number> = { A: 10, B: 20, C: 30, D: 40 }
const MOTO_RANK: Record<string, number> = { A: 10, B4: 20, B1: 21, B: 22, C: 30 }

/** The rank of a coverage code among those of its kind of vehicle; 0 for one nobody knows. */
export function coverageRank(code: string | null | undefined, isMoto: boolean): number {
  const key = (code ?? '').trim().toUpperCase()
  if (!key) return 0
  if (isMoto) return MOTO_RANK[key] ?? CAR_FAMILY_RANK[key.charAt(0)] ?? 0
  return CAR_RANK[key] ?? CAR_FAMILY_RANK[key.charAt(0)] ?? 0
}

/** What the office offers a car on these coverages next (JPMG, 2026-11-10): C2 → C Full, C Full → todo riesgo. */
const CAR_NEXT_STEP: Record<string, string> = {
  C2: 'se puede pasar a C Full',
  'C2 FULL': 'se puede pasar a Todo Riesgo (D3)',
  C7: 'se puede pasar a Todo Riesgo (D3)',
}

/** The better coverage to offer a car on this one, when the office has a usual next step for it. */
export function nextCoverageStep(code: string | null | undefined, isMoto: boolean): string | null {
  if (isMoto) return null
  return CAR_NEXT_STEP[(code ?? '').trim().toUpperCase()] ?? null
}

const toArray = <T>(value: T | T[] | undefined | null): T[] => (Array.isArray(value) ? value : value ? [value] : [])

interface RawQuote {
  SDTSrvCotizacionOut?: {
    Coberturas?: unknown
  }
}

interface RawCoverage {
  Resultado?: { Estado?: string }
  Cotizaciones?: unknown
}

interface RawPrice {
  FormaPagoCod?: string
  ValorCuota?: string | number
}

/**
 * The lowest instalment a stored Triunfo quote offered, among the coverages it
 * priced and the payment methods the client is shown; null when it priced none.
 */
export function lowestInstallment(result: unknown): number | null {
  const out = (result as RawQuote | null)?.SDTSrvCotizacionOut
  const values = toArray(out?.Coberturas as RawCoverage | RawCoverage[] | undefined)
    .filter(c => c.Resultado?.Estado === 'S')
    .flatMap(c => toArray(c.Cotizaciones as RawPrice | RawPrice[] | undefined))
    .filter(q => isVisiblePaymentMethod(q.FormaPagoCod))
    .map(q => Number.parseFloat(String(q.ValorCuota ?? '0')) || 0)
    .filter(v => v > 0)
  return values.length ? Math.min(...values) : null
}
