import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { of } from 'rxjs'
import { InfoAutoService } from './infoauto.service'
import { VehicleType } from './infoauto.types'

const token = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64')}.x`

describe('InfoAutoService motorcycle catalog', () => {
  const values: Record<string, string> = {
    INFOAUTO_BASE_URL: 'https://infoauto.test/cars/pub',
    INFOAUTO_AUTH_URL: 'https://infoauto.test/cars/auth',
    INFOAUTO_EMAIL: 'cars@example.com',
    INFOAUTO_PASSWORD: 'cars-secret',
    INFOAUTO_MOTO_BASE_URL: 'https://infoauto.test/motorcycles/pub',
    INFOAUTO_MOTO_AUTH_URL: 'https://infoauto.test/motorcycles/auth',
    INFOAUTO_MOTO_EMAIL: 'motos@example.com',
    INFOAUTO_MOTO_PASSWORD: 'motos-secret',
    INFOAUTO_PRICES_ENABLED: 'false',
  }

  function makeService(configValues = values) {
    const post = jest.fn().mockReturnValue(of({ data: { access_token: token } }))
    const get = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/features/')) {
        return of({
          data: url.includes('/motorcycles/') ? [{ id: 15, value: true }] : [{ id: 21, value: 'NO' }],
          headers: {},
        })
      }
      return of({ data: [{ id: 980, name: 'APPIA' }], headers: {} })
    })
    const config = {
      get: (key: string) => configValues[key],
      getOrThrow: (key: string) => {
        if (!configValues[key]) throw new Error(`Missing ${key}`)
        return configValues[key]
      },
    } as unknown as ConfigService
    const service = new InfoAutoService({ post, get } as unknown as HttpService, config)
    return { service, post, get }
  }

  it('authenticates each catalog with its own credentials and URL', async () => {
    const { service, post, get } = makeService()

    await service.getBrands(VehicleType.AUTO, {})
    await service.getBrands(VehicleType.MOTO, {})

    expect(post).toHaveBeenCalledWith(
      'https://infoauto.test/cars/auth/login',
      {},
      {
        auth: { username: 'cars@example.com', password: 'cars-secret' },
      },
    )
    expect(post).toHaveBeenCalledWith(
      'https://infoauto.test/motorcycles/auth/login',
      {},
      {
        auth: { username: 'motos@example.com', password: 'motos-secret' },
      },
    )
    expect(get).toHaveBeenCalledWith('https://infoauto.test/motorcycles/pub/brands/', expect.any(Object))
  })

  it('reads the motorcycle boolean origin feature instead of the car choice feature', async () => {
    const { service, get } = makeService()

    expect(await service.getVehicleOrigin(VehicleType.MOTO, 9800005)).toBe('I')
    expect(await service.getVehicleOrigin(VehicleType.AUTO, 120053)).toBe('N')
    expect(get).toHaveBeenCalledWith(
      'https://infoauto.test/motorcycles/pub/models/9800005/features/',
      expect.any(Object),
    )

    get.mockReturnValueOnce(of({ data: [{ id: 15, value: false }], headers: {} }))
    expect(await service.getVehicleOrigin(VehicleType.MOTO, 9800008)).toBe('N')
  })

  it('leaves motorcycle requests unavailable when the separate catalog is not configured', async () => {
    const configValues = { ...values }
    delete configValues.INFOAUTO_MOTO_BASE_URL
    delete configValues.INFOAUTO_MOTO_AUTH_URL
    const { service, post } = makeService(configValues)

    expect(service.isAvailable(VehicleType.MOTO)).toBe(false)
    await expect(service.getBrands(VehicleType.MOTO, {})).rejects.toMatchObject({ status: 503 })
    expect(post).not.toHaveBeenCalled()
  })
})
