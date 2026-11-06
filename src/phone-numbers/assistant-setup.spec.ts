import { BadRequestException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { assistantSetupData } from './assistant-setup'

const week = { mon: [{ from: '08:00', to: '16:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

describe('assistantSetupData', () => {
  it('changes nothing when the panel sends nothing (a reconnect keeps the number as it was)', () => {
    expect(assistantSetupData({})).toEqual({})
  })

  it('stores the name, the people, the hours and the presentation as the number’s own', () => {
    expect(
      assistantSetupData({
        botName: ' Nico ',
        presentationName: ' Vanesa Aguilar ',
        staffNames: ['Vanesa', ' Emilia', 'vanesa', ''],
        businessHours: week,
      }),
    ).toEqual({
      botName: 'Nico',
      staffNames: 'Vanesa, Emilia',
      businessHours: week,
      botProfile: { orgName: 'Vanesa Aguilar', orgLegalName: 'Vanesa Aguilar', orgShortName: 'Vanesa Aguilar' },
    })
  })

  it('clears a field sent empty on purpose', () => {
    expect(assistantSetupData({ botName: '  ', staffNames: [], presentationName: '' })).toEqual({
      botName: null,
      staffNames: null,
      botProfile: Prisma.DbNull,
    })
  })

  it('rejects hours that are not a week', () => {
    expect(() => assistantSetupData({ businessHours: { mon: 'todo el día' } })).toThrow(BadRequestException)
  })
})
