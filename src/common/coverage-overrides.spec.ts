import { BadRequestException } from '@nestjs/common'
import { normalizeCoverageOverrides, parseCoverageOverrides } from './coverage-overrides'

describe('coverage overrides', () => {
  it('reads what a number stored and drops what is malformed or empty', () => {
    expect(
      parseCoverageOverrides({
        A: { isActive: false },
        C1: { highlighted: true, sortOrder: 1 },
        D2: { isActive: 'no', sortOrder: -1 },
        B1: {},
      }),
    ).toEqual({
      A: { isActive: false, highlighted: null, sortOrder: null },
      C1: { isActive: null, highlighted: true, sortOrder: 1 },
    })
    expect(parseCoverageOverrides(null)).toEqual({})
    expect(parseCoverageOverrides(['A'])).toEqual({})
  })

  it('keeps only what the number sets and gives null when nothing is left', () => {
    expect(normalizeCoverageOverrides({ A: { isActive: false, highlighted: null }, C1: {} }, ['A', 'C1'])).toEqual({
      A: { isActive: false, highlighted: null, sortOrder: null },
    })
    expect(normalizeCoverageOverrides({ A: { isActive: null } }, ['A'])).toBeNull()
    expect(normalizeCoverageOverrides(null, ['A'])).toBeNull()
  })

  it('refuses unknown codes and wrong values', () => {
    expect(() => normalizeCoverageOverrides({ Z9: { isActive: true } }, ['A'])).toThrow(BadRequestException)
    expect(() => normalizeCoverageOverrides({ A: { isActive: 'yes' } }, ['A'])).toThrow(BadRequestException)
    expect(() => normalizeCoverageOverrides({ A: { sortOrder: 1.5 } }, ['A'])).toThrow(BadRequestException)
    expect(() => normalizeCoverageOverrides(['A'], ['A'])).toThrow(BadRequestException)
  })
})
