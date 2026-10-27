import { mergeBotProfile, parseBotProfile, toBotContextProfile } from './bot-profile'

describe('bot profile', () => {
  it('reads the stored JSON, dropping blanks and anything that is not text', () => {
    expect(parseBotProfile({ orgName: '  JPMG SRL ', orgShortName: '', towTruckPhone: 3415, extra: 'x' })).toEqual({
      orgName: 'JPMG SRL',
      orgShortName: null,
      orgLegalName: null,
      towTruckPhone: null,
      claimsPhone: null,
      cashPaymentPlaces: null,
      transferAlias: null,
      transferCbu: null,
      transferHolder: null,
      transferBank: null,
      claimsEmail: null,
    })
    expect(parseBotProfile(null).orgName).toBeNull()
    expect(parseBotProfile(['x']).orgName).toBeNull()
  })

  it('changes only the fields sent, and an empty one clears it', () => {
    const merged = mergeBotProfile(
      { orgName: 'Norte', towTruckPhone: '0800' },
      { towTruckPhone: '', claimsPhone: '0810' },
    )
    expect(merged).toMatchObject({ orgName: 'Norte', towTruckPhone: null, claimsPhone: '0810' })
  })

  it('offers a transfer only with an alias or a CBU', () => {
    const base = { name: 'Norte SRL' }
    expect(toBotContextProfile({ ...base, botProfile: { transferBank: 'Galicia' } }, false)?.transfer).toBeNull()
    expect(
      toBotContextProfile({ ...base, botProfile: { transferCbu: '0070', transferBank: 'Galicia' } }, false)?.transfer,
    ).toEqual({
      alias: null,
      cbu: '0070',
      holder: null,
      bank: 'Galicia',
    })
  })

  it("falls back to the organization's own name", () => {
    expect(toBotContextProfile({ name: 'Norte SRL', botProfile: null }, false)?.orgName).toBe('Norte SRL')
    expect(toBotContextProfile({ name: 'John', botProfile: null }, true)).toBeNull()
    expect(toBotContextProfile({ name: 'John', botProfile: { orgShortName: 'JPMG' } }, true)?.orgName).toBe('John')
  })
})
