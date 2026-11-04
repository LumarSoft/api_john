import { ConfigService } from '@nestjs/config'
import { readSettlementTerms, settle } from './settlement-terms'

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService
// Illustrative rates: the real ones live only in the server's .env.
const terms = { costPerMessageUsd: 0.03, partnerShare: 0.4 }

describe('the partner settlement', () => {
  it('takes the service cost per consumed message first and splits the rest by the partner share', () => {
    // A USD 25 plan with 300 consumed messages: 9 of cost, 16 to split, 40% of it to the partner.
    expect(settle(25, 300, terms)).toEqual({
      costPerMessageUsd: 0.03,
      partnerShare: 0.4,
      serviceCostUsd: 9,
      remainderUsd: 16,
      partnerShareUsd: 6.4,
      ownerShareUsd: 9.6,
    })
    // Other rates, same rule: 300 × 0.05 = 15; 25 − 15 = 10; a quarter of it to the partner.
    expect(settle(25, 300, { costPerMessageUsd: 0.05, partnerShare: 0.25 })).toMatchObject({
      serviceCostUsd: 15,
      remainderUsd: 10,
      partnerShareUsd: 2.5,
      ownerShareUsd: 7.5,
    })
  })

  it('charges a campaign message, which counts twice, as two messages', () => {
    // 200 replies + 50 campaign messages = 300 consumed: the same cost as 300 replies.
    expect(settle(25, 200 + 50 * 2, terms).serviceCostUsd).toBe(9)
  })

  it('takes the cost of a trial, which bills nothing, out of the split', () => {
    expect(settle(0, 80, terms)).toMatchObject({
      serviceCostUsd: 2.4,
      remainderUsd: -2.4,
      partnerShareUsd: -0.96,
      ownerShareUsd: -1.44,
    })
  })

  it('keeps the two shares adding up to the remainder when it does not split evenly', () => {
    const odd = settle(25, 333, { costPerMessageUsd: 0.03, partnerShare: 1 / 3 })
    expect(odd.serviceCostUsd).toBe(9.99)
    expect(odd.remainderUsd).toBe(15.01)
    expect(odd.partnerShareUsd).toBe(5)
    expect(odd.ownerShareUsd).toBe(10.01)
    const uneven = settle(25, 333, terms)
    expect(uneven.partnerShareUsd).toBe(6)
    expect(uneven.ownerShareUsd).toBe(9.01)
    for (const split of [odd, uneven])
      expect(Math.round((split.partnerShareUsd + split.ownerShareUsd) * 100) / 100).toBe(split.remainderUsd)
  })

  it('reads the rates from the environment and refuses nonsense', () => {
    expect(readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '0.03', PARTNER_PROFIT_SHARE: '0.4' }))).toEqual(
      terms,
    )
    expect(
      readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: ' 0.035 ', PARTNER_PROFIT_SHARE: '0.25' })),
    ).toEqual({ costPerMessageUsd: 0.035, partnerShare: 0.25 })
    expect(() =>
      readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '0.03', PARTNER_PROFIT_SHARE: '1.5' })),
    ).toThrow()
    expect(() =>
      readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '-1', PARTNER_PROFIT_SHARE: '0.4' })),
    ).toThrow()
    expect(() =>
      readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: 'abc', PARTNER_PROFIT_SHARE: '0.4' })),
    ).toThrow()
  })

  it('has no default: without both rates the settlement is not configured', () => {
    expect(readSettlementTerms(config({}))).toBeNull()
    expect(readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '0.03' }))).toBeNull()
    expect(readSettlementTerms(config({ PARTNER_PROFIT_SHARE: '0.4' }))).toBeNull()
    expect(readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '', PARTNER_PROFIT_SHARE: ' ' }))).toBeNull()
  })
})
