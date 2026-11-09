import { BalanceTally, attributeCode, emptyValues, type CodeAttribution } from './balance-metrics'

// Codes 10 (master, office line M1) and 20 (branch line B1); code 30 was deleted.
const ctx: CodeAttribution = {
  codeIds: new Set([10, 20]),
  masterCodeId: 10,
  byMetaNumber: new Map([
    ['M1', 10],
    ['B1', 20],
  ]),
  byNumberId: new Map([
    [1, 10],
    [2, 20],
  ]),
}

describe('attributeCode', () => {
  it("credits a record to its own code, else its number's, else the master code", () => {
    expect(attributeCode(ctx, { producerCodeId: 20, metaPhoneNumberId: 'M1' })).toBe(20)
    expect(attributeCode(ctx, { producerCodeId: null, metaPhoneNumberId: 'B1' })).toBe(20)
    expect(attributeCode(ctx, { producerCodeId: null, phoneNumberId: 2 })).toBe(20)
    expect(attributeCode(ctx, { producerCodeId: null, metaPhoneNumberId: null })).toBe(10)
  })

  it('never credits a code the organization no longer has', () => {
    expect(attributeCode(ctx, { producerCodeId: 30, metaPhoneNumberId: 'B1' })).toBe(20)
    expect(attributeCode(ctx, { producerCodeId: 30 })).toBe(10)
    expect(attributeCode(ctx, { metaPhoneNumberId: 'UNKNOWN' })).toBe(10)
  })

  it('credits a quote to the number it came through before its default code', () => {
    expect(attributeCode(ctx, { producerCodeId: 10, metaPhoneNumberId: 'B1' }, true)).toBe(20)
    expect(attributeCode(ctx, { producerCodeId: 10, metaPhoneNumberId: null }, true)).toBe(10)
  })
})

describe('BalanceTally', () => {
  it('starts every code at 0, and at null what a rebuilt month cannot know', () => {
    expect(emptyValues(true)).toMatchObject({ debtAmount: 0, claimsOpen: 0, policiesInForce: 0 })
    expect(emptyValues(false)).toMatchObject({
      premiumInForce: null,
      debtAmount: null,
      installmentsOverdue: null,
      installmentsRejected: null,
      claimsOpen: null,
      requestsClosed: null,
      policiesInForce: 0,
      claimsFiled: 0,
      messagesSent: 0,
    })
  })

  it('adds per code and leaves an unknown metric null instead of counting it', () => {
    const tally = new BalanceTally(ctx, false)
    tally.add('claimsFiled', { producerCodeId: 20 }, 3)
    tally.add('claimsFiled', { producerCodeId: null })
    tally.add('claimsOpen', { producerCodeId: 20 }, 5)
    const result = tally.result()
    expect(result.get(20)).toMatchObject({ claimsFiled: 3, claimsOpen: null })
    expect(result.get(10)).toMatchObject({ claimsFiled: 1, claimsOpen: null })
    expect([...result.keys()]).toEqual([10, 20])
  })

  it('rounds amounts to cents', () => {
    const tally = new BalanceTally(ctx, true)
    tally.add('debtAmount', { producerCodeId: 10 }, 0.1)
    tally.add('debtAmount', { producerCodeId: 10 }, 0.2)
    expect(tally.result().get(10)?.debtAmount).toBe(0.3)
  })
})
