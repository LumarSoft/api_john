import { CAMPAIGNS, CAMPAIGN_KINDS, settingsOf } from './campaign-catalog'
import { howItWorks } from './campaign-guide'

describe('howItWorks', () => {
  it('explains every campaign with who it finds, when it writes again and what they all share', () => {
    for (const kind of CAMPAIGN_KINDS) {
      const steps = howItWorks(CAMPAIGNS[kind], settingsOf(CAMPAIGNS[kind], null))
      expect(steps).toHaveLength(5)
      expect(steps[0]).toMatch(/^Busca /)
      expect(steps[2]).toMatch(/^Nada sale solo/)
    }
  })

  it('says the renewal days the organization set, and drops the reminders when it has none', () => {
    const renewal = CAMPAIGNS.renewal
    const [who, again] = howItWorks(renewal, settingsOf(renewal, { daysBefore: 45, reminderDays: [20, 10, 5] }))
    expect(who).toContain('en los próximos 45 días')
    expect(again).toContain('cuando faltan 20, 10 y 5 días')

    const [, once] = howItWorks(renewal, settingsOf(renewal, { reminderDays: [] }))
    expect(once).toBe('A quien ya le escribiste no te lo vuelve a ofrecer hasta que pasen 60 días.')
  })

  it('names the coverages, the sum and the products of the settings', () => {
    const upgrade = CAMPAIGNS.coverage_upgrade
    expect(howItWorks(upgrade, settingsOf(upgrade, { reviewSumBelow: 5000000 }))[0]).toContain(
      'con cobertura A, B o B1 o asegurados por menos de $ 5.000.000',
    )
    const cross = CAMPAIGNS.cross_sell
    expect(howItWorks(cross, settingsOf(cross, { offer: ['home', 'commercial'] }))[0]).toContain(
      'les falta alguno de estos: hogar; comercio.',
    )
  })
})
