import { ConfigService } from '@nestjs/config'
import { readSettlementTerms, settle } from './settlement-terms'

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService
const terms = { costPerMessageUsd: 0.04, partnerShare: 0.5 }

describe('the partner settlement', () => {
  it('takes Lumarsoft’s cost per consumed message first and splits the rest in half', () => {
    // Inicial (USD 25) with 300 consumed messages: 12 of cost, 13 to split.
    expect(settle(25, 300, terms)).toEqual({
      costPerMessageUsd: 0.04,
      partnerShare: 0.5,
      serviceCostUsd: 12,
      remainderUsd: 13,
      partnerShareUsd: 6.5,
      ownerShareUsd: 6.5,
    })
  })

  it('charges a template that counts twice as two messages', () => {
    // 200 replies + 50 templates = 300 consumed: the same cost as 300 replies.
    expect(settle(25, 200 + 50 * 2, terms).serviceCostUsd).toBe(12)
  })

  it('takes the cost of a trial, which bills nothing, out of the split', () => {
    expect(settle(0, 80, terms)).toMatchObject({
      serviceCostUsd: 3.2,
      remainderUsd: -3.2,
      partnerShareUsd: -1.6,
      ownerShareUsd: -1.6,
    })
  })

  it('keeps the two shares adding up to the remainder when it does not split evenly', () => {
    const odd = settle(25, 333, { costPerMessageUsd: 0.04, partnerShare: 1 / 3 })
    expect(odd.remainderUsd).toBe(11.68)
    expect(odd.partnerShareUsd).toBe(3.89)
    expect(odd.ownerShareUsd).toBe(7.79)
    expect(Math.round((odd.partnerShareUsd + odd.ownerShareUsd) * 100) / 100).toBe(odd.remainderUsd)
  })

  it('reads the rates from the environment, 0.04 and half by default, and refuses nonsense', () => {
    expect(readSettlementTerms(config({}))).toEqual({ costPerMessageUsd: 0.04, partnerShare: 0.5 })
    expect(readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '0.035', PARTNER_PROFIT_SHARE: '0.4' }))).toEqual(
      { costPerMessageUsd: 0.035, partnerShare: 0.4 },
    )
    expect(() => readSettlementTerms(config({ PARTNER_PROFIT_SHARE: '1.5' }))).toThrow()
    expect(() => readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: '-1' }))).toThrow()
    expect(() => readSettlementTerms(config({ PARTNER_COST_PER_MESSAGE_USD: 'abc' }))).toThrow()
  })
})
