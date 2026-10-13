import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { TriunfoService } from '../triunfo/triunfo.service'
import { CarteraSyncService } from './cartera-sync.service'

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
