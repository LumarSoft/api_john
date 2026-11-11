import { BadRequestException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { assistantSetupData, validateAssistantSetup, type CurrentAssistant } from './assistant-setup'

const week = { mon: [{ from: '08:00', to: '16:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
const orgWeek = { mon: [{ from: '09:00', to: '18:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

/** An organization with its whole assistant configured. */
const organization: CurrentAssistant['organization'] = {
  name: 'Seguros Norte SRL',
  botName: 'Juli',
  staffNames: 'Caro, Mili',
  businessHours: orgWeek,
  botProfile: {
    orgName: 'Seguros Norte',
    orgLegalName: 'Seguros Norte SRL',
    transferAlias: 'NORTE.SEGUROS',
    transferCbu: '0000003100000000000001',
    transferHolder: 'Seguros Norte SRL',
  },
}

const blank = { botName: null, staffNames: null, businessHours: null, botProfile: null }
const newNumber: CurrentAssistant = { organization, number: null }

describe('assistantSetupData', () => {
  it('changes nothing when the panel sends nothing', () => {
    expect(assistantSetupData({}, newNumber)).toEqual({})
  })

  it('stores what a new number does differently from its organization as its own', () => {
    expect(
      assistantSetupData(
        {
          botName: ' Nico ',
          presentationName: ' Vanesa Aguilar ',
          transferAlias: ' TRUENO.VUELO.DELTA ',
          staffNames: ['Vanesa', ' Emilia', 'vanesa', ''],
          businessHours: week,
        },
        newNumber,
      ),
    ).toEqual({
      botName: 'Nico',
      staffNames: 'Vanesa, Emilia',
      businessHours: week,
      botProfile: {
        orgName: 'Vanesa Aguilar',
        orgLegalName: 'Vanesa Aguilar',
        orgShortName: 'Vanesa Aguilar',
        transferAlias: 'TRUENO.VUELO.DELTA',
      },
    })
  })

  it("leaves what equals the organization's to the organization: the same alias keeps its whole account", () => {
    expect(
      assistantSetupData(
        {
          botName: 'Juli',
          presentationName: 'Seguros Norte',
          transferAlias: 'norte.seguros',
          staffNames: ['Caro', 'Mili'],
          businessHours: orgWeek,
        },
        newNumber,
      ),
    ).toEqual({})
  })

  it('compares the presentation with the organization name when the organization has no own name for the bot', () => {
    const plain = { ...organization, botProfile: null }
    expect(
      assistantSetupData({ presentationName: 'Seguros Norte SRL' }, { organization: plain, number: null }),
    ).toEqual({})
  })

  describe('reconnecting a number that already has its own assistant', () => {
    const own = {
      botName: 'Nico',
      staffNames: 'Vanesa, Emilia',
      businessHours: week,
      botProfile: {
        orgName: 'Vanesa Aguilar',
        orgLegalName: 'Vanesa Aguilar SA',
        orgShortName: 'VA',
        transferAlias: 'TRUENO.VUELO.DELTA',
        transferCbu: '0000003100000000000002',
        transferHolder: 'Vanesa Aguilar',
        transferBank: 'Banco Nación',
        towTruckPhone: '0800-111-2222',
        quoteClosingNote: 'Te mejoramos el precio.',
      },
    }
    const reconnect: CurrentAssistant = { organization, number: own }

    it('changes nothing when the prefilled form comes back as it was', () => {
      expect(
        assistantSetupData(
          {
            botName: 'Nico',
            presentationName: 'Vanesa Aguilar',
            transferAlias: 'TRUENO.VUELO.DELTA',
            staffNames: ['Vanesa', 'Emilia'],
            businessHours: week,
          },
          reconnect,
        ),
      ).toEqual({})
    })

    it('keeps its CBU, holder, bank and lines when the alias changes', () => {
      expect(assistantSetupData({ transferAlias: 'NUEVO.ALIAS' }, reconnect)).toEqual({
        botProfile: { ...own.botProfile, transferAlias: 'NUEVO.ALIAS' },
      })
    })

    it("goes back to the organization's whole account when the organization's alias is typed", () => {
      const { transferAlias, transferCbu, transferHolder, transferBank, ...rest } = own.botProfile
      expect([transferAlias, transferCbu, transferHolder, transferBank].every(Boolean)).toBe(true)
      expect(assistantSetupData({ transferAlias: 'NORTE.SEGUROS' }, reconnect)).toEqual({ botProfile: rest })
    })

    it('renames the presentation without touching the rest of its profile', () => {
      expect(assistantSetupData({ presentationName: 'Vanesa' }, reconnect)).toEqual({
        botProfile: { ...own.botProfile, orgName: 'Vanesa', orgLegalName: 'Vanesa', orgShortName: 'Vanesa' },
      })
    })

    it('keeps following the organization on what it inherited', () => {
      const inherits: CurrentAssistant = { organization, number: blank }
      expect(
        assistantSetupData(
          {
            botName: 'Juli',
            presentationName: 'Seguros Norte',
            transferAlias: 'NORTE.SEGUROS',
            staffNames: ['Caro', 'Mili'],
            businessHours: orgWeek,
          },
          inherits,
        ),
      ).toEqual({})
    })
  })

  describe('a branch that gives no alias', () => {
    it("stores that the office passes the data, never the organization's account", () => {
      expect(assistantSetupData({ transferMode: 'office', transferAlias: 'NORTE.SEGUROS' }, newNumber)).toEqual({
        botProfile: { transferMode: 'office' },
      })
    })

    it('drops the account the number had of its own and keeps the rest', () => {
      const number = {
        ...blank,
        botProfile: { transferAlias: 'VIEJO.ALIAS', transferCbu: '0070', claimsPhone: '0810' },
      }
      expect(assistantSetupData({ transferMode: 'office' }, { organization, number })).toEqual({
        botProfile: { transferMode: 'office', claimsPhone: '0810' },
      })
    })

    it('changes nothing when it comes back as it was', () => {
      const number = { ...blank, botProfile: { transferMode: 'office' } }
      expect(assistantSetupData({ transferMode: 'office' }, { organization, number })).toEqual({})
      expect(assistantSetupData({ transferAlias: '' }, { organization, number })).toEqual({})
    })

    it("gives an alias again, its own or the organization's", () => {
      const number = { ...blank, botProfile: { transferMode: 'office', claimsPhone: '0810' } }
      expect(assistantSetupData({ transferAlias: 'ROLDAN.PAGOS' }, { organization, number })).toEqual({
        botProfile: { transferAlias: 'ROLDAN.PAGOS', claimsPhone: '0810' },
      })
      expect(
        assistantSetupData({ transferMode: '', transferAlias: 'norte.seguros' }, { organization, number }),
      ).toEqual({
        botProfile: { claimsPhone: '0810' },
      })
    })
  })

  it("clears the number's own values sent empty on purpose", () => {
    const own = { botName: 'Nico', staffNames: 'Vanesa', businessHours: null, botProfile: { transferAlias: 'X.Y.Z' } }
    expect(
      assistantSetupData(
        { botName: '  ', staffNames: [], transferAlias: ' ' },
        { organization: { ...organization, botName: null, staffNames: null }, number: own },
      ),
    ).toEqual({ botName: null, staffNames: null, botProfile: Prisma.DbNull })
  })

  it('rejects hours that are not a week', () => {
    expect(() => validateAssistantSetup({ businessHours: { mon: 'todo el día' } })).toThrow(BadRequestException)
    expect(() => assistantSetupData({ businessHours: { mon: 'todo el día' } }, newNumber)).toThrow(BadRequestException)
  })
})
