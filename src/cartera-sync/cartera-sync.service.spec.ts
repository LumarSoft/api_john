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

describe('CarteraSyncService per organization', () => {
  it("asks each organization's codes with its own credentials and skips one without them", async () => {
    const prisma = {
      producer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, masterCode: '11425', producerCodes: [{ id: 10, code: '11425', lastCarteraSyncAt: new Date() }] },
          { id: 2, masterCode: '20001', producerCodes: [{ id: 20, code: '20001', lastCarteraSyncAt: null }] },
          { id: 3, masterCode: '30001', producerCodes: [{ id: 30, code: '30001', lastCarteraSyncAt: null }] },
        ]),
      },
      producerCode: { update: jest.fn().mockResolvedValue({}) },
    }
    const jpmg = { productor: '10484', usuario: 'JPMG', password: 'a' }
    const norte = { productor: '20001', usuario: 'NORTE', password: 'b' }
    const triunfo = {
      credentialsFor: jest.fn(async (id: number) => {
        if (id === 1) return jpmg
        if (id === 2) return norte
        throw new Error('La organización 3 no tiene configurada la integración con Triunfo')
      }),
      getNovedadesCartera: jest.fn().mockResolvedValue([]),
    }
    const service = new CarteraSyncService(
      prisma as unknown as PrismaService,
      triunfo as unknown as TriunfoService,
      { get: () => undefined } as unknown as ConfigService,
    )

    const result = await service.syncCartera()

    expect(triunfo.getNovedadesCartera.mock.calls.map(call => [call[2], call[3]])).toEqual([
      [jpmg, '11425'],
      [norte, '20001'],
    ])
    expect(prisma.producerCode.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 30 } }))
    expect(result.codesProcessed).toBe(2)
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
