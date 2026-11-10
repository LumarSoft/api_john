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
