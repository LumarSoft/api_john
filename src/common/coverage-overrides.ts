import { BadRequestException } from '@nestjs/common'

/**
 * What a number changes about one of its organization's coverages: whether it
 * offers it, whether it recommends it and where it goes in the list. Each
 * field left null is the organization's.
 */
export interface CoverageOverride {
  isActive: boolean | null
  highlighted: boolean | null
  sortOrder: number | null
}

/** Stored flat in PhoneNumber.coverageSettings, keyed by Triunfo code. */
export type CoverageOverrides = Record<string, CoverageOverride>

const MAX_SORT_ORDER = 999

const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)
const order = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SORT_ORDER ? value : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Reads the stored JSON; anything missing or malformed is null, codes with nothing set are dropped. */
export function parseCoverageOverrides(raw: unknown): CoverageOverrides {
  if (!isRecord(raw)) return {}
  const overrides: CoverageOverrides = {}
  for (const [code, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const override = {
      isActive: bool(value.isActive),
      highlighted: bool(value.highlighted),
      sortOrder: order(value.sortOrder),
    }
    if (override.isActive !== null || override.highlighted !== null || override.sortOrder !== null)
      overrides[code] = override
  }
  return overrides
}

/**
 * What a PATCH sends, checked and reduced to what is set: a code the
 * organization has no coverage for, a field that is not a boolean, or an
 * order out of range is refused. Null (or nothing left) means "as the
 * organization", so the caller stores no JSON at all.
 */
export function normalizeCoverageOverrides(input: unknown, knownCodes: string[]): CoverageOverrides | null {
  if (input === null) return null
  if (!isRecord(input)) throw new BadRequestException('coverageSettings must be an object keyed by coverage code')
  const overrides: CoverageOverrides = {}
  for (const [code, value] of Object.entries(input)) {
    if (!knownCodes.includes(code)) throw new BadRequestException(`Unknown coverage code: ${code}`)
    if (!isRecord(value)) throw new BadRequestException(`coverageSettings.${code} must be an object`)
    for (const field of ['isActive', 'highlighted'] as const) {
      if (value[field] != null && typeof value[field] !== 'boolean')
        throw new BadRequestException(`coverageSettings.${code}.${field} must be a boolean`)
    }
    if (value.sortOrder != null && order(value.sortOrder) === null)
      throw new BadRequestException(
        `coverageSettings.${code}.sortOrder must be an integer between 0 and ${MAX_SORT_ORDER}`,
      )
    const override = {
      isActive: bool(value.isActive),
      highlighted: bool(value.highlighted),
      sortOrder: order(value.sortOrder),
    }
    if (override.isActive !== null || override.highlighted !== null || override.sortOrder !== null)
      overrides[code] = override
  }
  return Object.keys(overrides).length ? overrides : null
}
