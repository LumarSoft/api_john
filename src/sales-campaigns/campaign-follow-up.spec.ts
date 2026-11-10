import { SalesOpportunityStatus } from 'generated/prisma/client'
import { CAMPAIGNS, settingsOf } from './campaign-catalog'
import { followUpOf, isOptOutRequest } from './campaign-follow-up'

const NOW = new Date('2026-11-10T15:00:00Z')
const day = (iso: string) => new Date(`${iso}T15:00:00Z`)
const { CONTACTED, REPLIED } = SalesOpportunityStatus

describe('followUpOf', () => {
  describe('Cotizaciones sin cerrar', () => {
    const quotes = CAMPAIGNS.quote_followup
    const settings = settingsOf(quotes, null)
    const follow = (contacts: Date[], status: SalesOpportunityStatus | null = CONTACTED) =>
      followUpOf(quotes, settings, { contacts, status, endsAt: null }, NOW)

    it('has nothing to follow before the first contact', () => {
      expect(follow([])).toBeNull()
    })

    it('is due a second contact once the days pass without an answer, and not before', () => {
      expect(follow([day('2026-11-04')])).toEqual({ step: 2, of: 2, due: true, label: 'Segundo contacto' })
      expect(follow([day('2026-11-08')])?.due).toBe(false)
    })

    it('stops when the customer answered or after the second contact', () => {
      expect(follow([day('2026-11-04')], REPLIED)?.due).toBe(false)
      expect(follow([day('2026-10-28'), day('2026-11-03')])?.due).toBe(false)
    })

    it('writes once when the office turns the second contact off', () => {
      const once = settingsOf(quotes, { secondContactDays: 0 })
      expect(
        followUpOf(quotes, once, { contacts: [day('2026-11-01')], status: CONTACTED, endsAt: null }, NOW),
      ).toBeNull()
    })
  })

  describe('Renovaciones', () => {
    const renewal = CAMPAIGNS.renewal
    const settings = settingsOf(renewal, null)
    const follow = (endsAt: Date, contacts: Date[], status: SalesOpportunityStatus | null = CONTACTED) =>
      followUpOf(renewal, settings, { contacts, status, endsAt }, NOW)

    it('reminds at 15 and at 7 days of who got the first notice and did not answer', () => {
      // 12 days left, written to 25 days before the end: the 15-day reminder.
      expect(follow(day('2026-11-22'), [day('2026-10-28')])).toEqual({
        step: 2,
        of: 3,
        due: true,
        label: 'Recordatorio: faltan 12 días',
      })
      // 5 days left and the 15-day reminder went out: the 7-day one.
      expect(follow(day('2026-11-15'), [day('2026-10-20'), day('2026-11-02')])).toEqual({
        step: 3,
        of: 3,
        due: true,
        label: 'Recordatorio: faltan 5 días',
      })
    })

    it('does not remind twice in the same step, nor who answered', () => {
      expect(follow(day('2026-11-22'), [day('2026-10-28'), day('2026-11-08')])?.due).toBe(false)
      expect(follow(day('2026-11-22'), [day('2026-10-28')], REPLIED)?.due).toBe(false)
    })

    it('has no reminder while the first step lasts, nor for last year’s notice', () => {
      expect(follow(day('2026-11-30'), [day('2026-11-05')])).toBeNull()
      expect(follow(day('2026-11-22'), [day('2025-11-01')])).toBeNull()
    })

    it('writes once when the office leaves the reminders empty', () => {
      const once = settingsOf(renewal, { reminderDays: [] })
      const input = { contacts: [day('2026-10-28')], status: CONTACTED, endsAt: day('2026-11-15') }
      expect(followUpOf(renewal, once, input, NOW)).toBeNull()
    })
  })
})

describe('isOptOutRequest', () => {
  it.each([
    'No me escriban más',
    'no me manden mas mensajes por favor',
    'No quiero recibir publicidad',
    'no quiero que me escriban',
    'Dejen de mandarme mensajes',
    'dejá de escribirme',
    'no me molesten',
    'Sáquenme de la lista de difusión',
    'STOP',
  ])('reads "%s" as a request not to be written to', text => {
    expect(isOptOutRequest(text)).toBe(true)
  })

  it.each([
    'No me mandaron la póliza',
    'Quiero dar de baja el seguro del auto',
    'No me escribieron nunca por la renovación',
    'Hola, sí, pasame las opciones',
    'No, gracias',
    'baja',
    '',
  ])('does not read "%s" as one', text => {
    expect(isOptOutRequest(text)).toBe(false)
  })
})
