import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { TriunfoService } from '../triunfo/triunfo.service'
import { riesgosOf } from '../common/poliza-detail'
import { CarteraSyncService, resolveRiskType } from './cartera-sync.service'

describe('CarteraSyncService on boot', () => {
  function setup(env: Record<string, string>) {
    const config = { get: (key: string) => env[key] }
    const service = new CarteraSyncService(
      {} as PrismaService,
      {} as TriunfoService,
      config as unknown as ConfigService,
    )
    const runGuarded = jest.spyOn(service, 'runGuarded').mockResolvedValue({} as never)
    return { service, runGuarded }
  }

  it('does not sync on a deploy or restart by default', () => {
    const { service, runGuarded } = setup({ TRIUNFO_CARTERA_SYNC_ENABLED: 'true' })

    service.onApplicationBootstrap()

    expect(runGuarded).not.toHaveBeenCalled()
  })

  it('syncs on boot when TRIUNFO_CARTERA_SYNC_ON_BOOT is true', () => {
    const { service, runGuarded } = setup({
      TRIUNFO_CARTERA_SYNC_ENABLED: 'true',
      TRIUNFO_CARTERA_SYNC_ON_BOOT: 'true',
    })

    service.onApplicationBootstrap()

    expect(runGuarded).toHaveBeenCalledTimes(1)
  })

  it('never syncs while the sync is disabled', () => {
    const { service, runGuarded } = setup({ TRIUNFO_CARTERA_SYNC_ON_BOOT: 'true' })

    service.onApplicationBootstrap()

    expect(runGuarded).not.toHaveBeenCalled()
  })
})

describe('resolveRiskType', () => {
  const covering = (...items: Array<[string, string]>) =>
    riesgosOf({
      SDTOtrosRiesgosDatos: { SDTRiesgosCoberturas: items.map(([Riesgo, Cobertura]) => ({ Riesgo, Cobertura })) },
    })

  it('goes by the article Triunfo sends', () => {
    expect(resolveRiskType(null, 128, [])).toBe('life')
    expect(resolveRiskType(null, '267', covering(['ADICIONAL DE VIDA', 'TITULAR'], ['INCENDIO', 'EDIFICIO']))).toBe(
      'home',
    )
    expect(resolveRiskType(null, 657, covering(['ROBO', 'BICICLETA']))).toBe('other')
  })

  it('puts personal accidents under another article with the policies on a person', () => {
    expect(
      resolveRiskType(null, 194, covering(['CATEGORIA 1', 'MUERTE'], ['CATEGORIA 1', 'INCAP.TOTAL/PARCIAL'])),
    ).toBe('life')
  })
})
