import { mergeBotProfile, overlayBotProfile, parseBotProfile, toBotContextProfile } from './bot-profile'

describe('bot profile', () => {
  it('reads the stored JSON, dropping blanks and anything that is not text', () => {
    expect(parseBotProfile({ orgName: '  JPMG SRL ', orgShortName: '', towTruckPhone: 3415, extra: 'x' })).toEqual({
      orgName: 'JPMG SRL',
      orgShortName: null,
      orgLegalName: null,
      towTruckPhone: null,
      claimsPhone: null,
      cashPaymentPlaces: null,
      transferMode: null,
      transferAlias: null,
      transferCbu: null,
      transferHolder: null,
      transferBank: null,
      claimsEmail: null,
      quoteClosingNote: null,
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

  it('keeps only a transfer mode that exists', () => {
    expect(parseBotProfile({ transferMode: 'office' }).transferMode).toBe('office')
    expect(parseBotProfile({ transferMode: 'nunca' }).transferMode).toBeNull()
  })

  it('drops the account when the office passes the data, and stops it when an account is typed', () => {
    const account = { transferAlias: 'NORTE.PAGOS', transferCbu: '0070', transferBank: 'Galicia', claimsPhone: '0810' }
    expect(mergeBotProfile(account, { transferMode: 'office' })).toMatchObject({
      transferMode: 'office',
      transferAlias: null,
      transferCbu: null,
      transferBank: null,
      claimsPhone: '0810',
    })
    expect(mergeBotProfile({ transferMode: 'office' }, { transferAlias: 'ROLDAN.PAGOS' })).toMatchObject({
      transferMode: null,
      transferAlias: 'ROLDAN.PAGOS',
    })
    // Clearing the account (back to the organization's) does not stop the office mode by itself.
    expect(mergeBotProfile({ transferMode: 'office' }, { transferAlias: '' }).transferMode).toBe('office')
    expect(mergeBotProfile({ transferMode: 'office' }, { transferMode: '' }).transferMode).toBeNull()
  })

  it('gives the bot no account when the office passes the data', () => {
    const botProfile = { transferMode: 'office', transferAlias: 'QUEDO.GUARDADO', transferCbu: '0070' }
    expect(toBotContextProfile({ name: 'Norte SRL', botProfile }, false)?.transfer).toBeNull()
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

  it('hands the bot the quote closing line as the organization wrote it', () => {
    const base = { name: 'Norte SRL' }
    expect(toBotContextProfile({ ...base, botProfile: {} }, false)?.quoteClosingNote).toBeNull()
    expect(
      toBotContextProfile({ ...base, botProfile: { quoteClosingNote: ' Un asesor te mejora el precio ' } }, false)
        ?.quoteClosingNote,
    ).toBe('Un asesor te mejora el precio')
  })

  it("falls back to the organization's own name", () => {
    expect(toBotContextProfile({ name: 'Norte SRL', botProfile: null }, false)?.orgName).toBe('Norte SRL')
    expect(toBotContextProfile({ name: 'John', botProfile: null }, true)).toBeNull()
    expect(toBotContextProfile({ name: 'John', botProfile: { orgShortName: 'JPMG' } }, true)?.orgName).toBe('John')
  })
})

describe('overlayBotProfile', () => {
  const organization = {
    orgName: 'Seguros Norte',
    towTruckPhone: '0800-111-2222',
    transferAlias: 'NORTE.PAGOS',
    transferCbu: '0000003100000000000001',
    transferHolder: 'Seguros Norte SRL',
    transferBank: 'Banco Macro',
  }

  it("fills what the number leaves empty with the organization's", () => {
    expect(overlayBotProfile(organization, { orgName: 'Seguros Norte Rafaela' })).toMatchObject({
      orgName: 'Seguros Norte Rafaela',
      towTruckPhone: '0800-111-2222',
      transferAlias: 'NORTE.PAGOS',
      transferCbu: '0000003100000000000001',
    })
  })

  it("never mixes the number's account with the organization's", () => {
    expect(overlayBotProfile(organization, { transferAlias: 'RAFAELA.PAGOS' })).toMatchObject({
      transferAlias: 'RAFAELA.PAGOS',
      transferCbu: null,
      transferHolder: null,
      transferBank: null,
    })
  })

  it("never shows the organization's account on a number whose office passes the data", () => {
    const profile = overlayBotProfile(organization, { transferMode: 'office' })
    expect(profile).toMatchObject({
      transferMode: 'office',
      transferAlias: null,
      transferCbu: null,
      transferHolder: null,
      transferBank: null,
      towTruckPhone: '0800-111-2222',
    })
    expect(toBotContextProfile({ name: 'Norte SRL', botProfile: profile }, false)?.transfer).toBeNull()
  })

  it("takes the organization's office mode on a number without a transfer of its own", () => {
    expect(overlayBotProfile({ transferMode: 'office' }, {})?.transferMode).toBe('office')
    expect(overlayBotProfile({ transferMode: 'office' }, { transferAlias: 'PROPIO.ALIAS' })).toMatchObject({
      transferMode: null,
      transferAlias: 'PROPIO.ALIAS',
    })
  })

  it('stays null when neither has a profile', () => {
    expect(overlayBotProfile(null, null)).toBeNull()
  })

  it("gives a number its own quote closing line over the organization's", () => {
    expect(overlayBotProfile({ quoteClosingNote: 'Org' }, {})?.quoteClosingNote).toBe('Org')
    expect(overlayBotProfile({ quoteClosingNote: 'Org' }, { quoteClosingNote: 'Sucursal' })?.quoteClosingNote).toBe(
      'Sucursal',
    )
  })
})
