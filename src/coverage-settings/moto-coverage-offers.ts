import { BadRequestException } from '@nestjs/common'
import { MOTO_COVERAGE_CODES } from './coverage-defaults'

/**
 * Which coverages of the motorcycle catalog are offered, keyed by Triunfo code
 * and holding only the ones somebody changed. Stored in
 * Producer.motoCoverageSettings (a missing code is offered) and in
 * PhoneNumber.motoCoverageSettings (a missing code is the organization's).
 */
export type MotoCoverageOffers = Record<string, boolean>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Reads the stored JSON; anything that is not a catalog code with a boolean is dropped. */
export function parseMotoCoverageOffers(raw: unknown): MotoCoverageOffers {
  if (!isRecord(raw)) return {}
  const offers: MotoCoverageOffers = {}
  for (const code of MOTO_COVERAGE_CODES) {
    const value = raw[code]
    if (typeof value === 'boolean') offers[code] = value
  }
  return offers
}

/**
 * What a PATCH sends, checked and reduced to what is set: a code outside the
 * moto catalog or a value that is not a boolean is refused. Null (or nothing
 * left) means "as the organization", so the caller stores no JSON at all.
 */
export function normalizeMotoCoverageOffers(input: unknown): MotoCoverageOffers | null {
  if (input === null) return null
  if (!isRecord(input)) throw new BadRequestException('motoCoverageSettings must be an object keyed by coverage code')
  const offers: MotoCoverageOffers = {}
  for (const [code, value] of Object.entries(input)) {
    if (!MOTO_COVERAGE_CODES.includes(code)) throw new BadRequestException(`Unknown moto coverage code: ${code}`)
    if (value == null) continue
    if (typeof value !== 'boolean') throw new BadRequestException(`motoCoverageSettings.${code} must be a boolean`)
    offers[code] = value
  }
  return Object.keys(offers).length ? offers : null
}
