import { of } from 'rxjs'
import { ServiceUnavailableException } from '@nestjs/common'
import { InfoAutoService } from './infoauto.service'
import { VehicleType } from './infoauto.types'

describe('InfoAutoService', () => {
  const values: Record<string, string> = {
    INFOAUTO_BASE_URL: 'https://info.test/cars/pub',
    INFOAUTO_AUTH_URL: 'https://info.test/cars/auth',
    INFOAUTO_MOTO_BASE_URL: 'https://info.test/motorcycles/pub',
    INFOAUTO_MOTO_AUTH_URL: 'https://info.test/motorcycles/auth',
    INFOAUTO_EMAIL: 'cars-user',
    INFOAUTO_PASSWORD: 'cars-pass',
    INFOAUTO_MOTO_EMAIL: 'moto-user',
    INFOAUTO_MOTO_PASSWORD: 'moto-pass',
    INFOAUTO_PRICES_ENABLED: 'false',
  }

  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key]
      if (!value) throw new Error(`Missing ${key}`)
      return value
    }),
  }

  beforeEach(() => jest.clearAllMocks())

  it('authenticates the motorcycle catalog with its own credentials and accepts a header token', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: {}, headers: { 'x-access-token': 'opaque-moto-token' } })),
      get: jest.fn().mockReturnValue(of({ data: [{ id: 1, name: 'Honda' }], headers: {} })),
    }
    const service = new InfoAutoService(http as any, config as any)

    const result = await service.getBrands(VehicleType.MOTO, {} as any)

    expect(http.post).toHaveBeenCalledWith(
      'https://info.test/motorcycles/auth/login',
      {},
      expect.objectContaining({ auth: { username: 'moto-user', password: 'moto-pass' } }),
    )
    expect(http.get).toHaveBeenCalledWith(
      'https://info.test/motorcycles/pub/brands/',
      expect.objectContaining({ headers: { Authorization: 'Bearer opaque-moto-token' } }),
    )
    expect(result.data).toEqual([{ id: 1, name: 'Honda' }])
  })

  it('keeps motorcycle requests disabled when its URLs are absent', async () => {
    const withoutMoto = {
      ...config,
      get: jest.fn((key: string) =>
        key === 'INFOAUTO_MOTO_BASE_URL' || key === 'INFOAUTO_MOTO_AUTH_URL' ? undefined : values[key],
      ),
    }
    const service = new InfoAutoService({} as any, withoutMoto as any)

    expect(service.isAvailable(VehicleType.MOTO)).toBe(false)

    await expect(service.getBrands(VehicleType.MOTO, {} as any)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('loads motorcycle models directly by brand without exposing technical groups', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: { access_token: 'opaque-moto-token' }, headers: {} })),
      get: jest.fn().mockReturnValue(of({ data: [{ codia: 8810215, description: 'NAVI 110' }], headers: {} })),
    }
    const service = new InfoAutoService(http as any, config as any)

    await service.getBrandModels(VehicleType.MOTO, 881, { query_string: 'NAVI' })

    expect(http.get).toHaveBeenCalledWith(
      'https://info.test/motorcycles/pub/brands/881/models/',
      expect.objectContaining({ params: { query_string: 'NAVI' } }),
    )
  })

  it('maps the motorcycle Importado feature to Triunfo origin', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: { access_token: 'opaque-moto-token' }, headers: {} })),
      get: jest.fn().mockReturnValue(
        of({
          data: [{ id: 15, description: 'Importado', value: true }],
          headers: {},
        }),
      ),
    }
    const service = new InfoAutoService(http as any, config as any)

    await expect(service.getVehicleOrigin(VehicleType.MOTO, 9800005)).resolves.toBe('I')
    expect(http.get).toHaveBeenCalledWith(
      'https://info.test/motorcycles/pub/models/9800005/features/',
      expect.any(Object),
    )
  })
})
