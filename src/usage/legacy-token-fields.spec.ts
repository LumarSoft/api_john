import { legacyPricing, legacyTrialTokens, legacyUnitPriceUsd, withLegacyPlan } from './legacy-token-fields'

const catalog = [
  { id: 9, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true },
  { id: 1, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true },
  { id: 2, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true },
]

describe("the old token names for front_John's panel", () => {
  it('repeats a plan under its old names, counting the blocks it spans', () => {
    const plan = {
      id: null,
      name: 'Profesional + 1.000',
      includedMessages: 2000,
      priceUsd: 100,
      trial: false,
      extraBlocks: 1,
    }
    expect(withLegacyPlan(plan, 1000)).toEqual({ ...plan, includedTokens: 2000, blocks: 2 })
  })

  it('takes the old price per token from the largest active paid plan', () => {
    expect(legacyUnitPriceUsd(catalog)).toBe(0.05)
    expect(legacyUnitPriceUsd([])).toBe(0)
  })

  it('takes the old trial tokens from the active trial plan', () => {
    expect(legacyTrialTokens(catalog)).toBe(100)
    expect(legacyTrialTokens(catalog.filter(p => !p.isTrial))).toBe(0)
  })

  it("builds the owner's old pricing summary", () => {
    expect(legacyPricing(catalog, 1000)).toEqual({
      unitPriceUsd: 0.05,
      blockTokens: 1000,
      blockPriceUsd: 50,
      trialTokens: 100,
    })
  })
})
