import { of, throwError } from 'rxjs'
import { AxiosError, AxiosHeaders } from 'axios'
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
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

  const status = {
    succeeded: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => jest.clearAllMocks())

  it('authenticates the motorcycle catalog with its own credentials and accepts a header token', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: {}, headers: { 'x-access-token': 'opaque-moto-token' } })),
      get: jest.fn().mockReturnValue(of({ data: [{ id: 1, name: 'Honda' }], headers: {} })),
    }
    const service = new InfoAutoService(http as any, config as any, status as any)

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
    const service = new InfoAutoService({} as any, withoutMoto as any, status as any)

    expect(service.isAvailable(VehicleType.MOTO)).toBe(false)

    await expect(service.getBrands(VehicleType.MOTO, {} as any)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('loads motorcycle models directly by brand without exposing technical groups', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: { access_token: 'opaque-moto-token' }, headers: {} })),
      get: jest.fn().mockReturnValue(of({ data: [{ codia: 8810215, description: 'NAVI 110' }], headers: {} })),
    }
    const service = new InfoAutoService(http as any, config as any, status as any)

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
    const service = new InfoAutoService(http as any, config as any, status as any)

    await expect(service.getVehicleOrigin(VehicleType.MOTO, 9800005)).resolves.toBe('I')
    expect(http.get).toHaveBeenCalledWith(
      'https://info.test/motorcycles/pub/models/9800005/features/',
      expect.any(Object),
    )
  })
  it.each([
    [VehicleType.AUTO, 2024, 2018, false],
    [VehicleType.AUTO, 2018, 2018, true],
    [VehicleType.AUTO, 2009, 2018, false],
    [VehicleType.AUTO, 2026, 2025, false],
    [VehicleType.MOTO, 2026, 2025, true],
    [VehicleType.MOTO, 2030, 2025, false],
  ])('validates %s year %i with catalog ending %i', async (type, year, to, valid) => {
    jest.useFakeTimers({ now: new Date('2026-09-30T12:00:00Z') })
    try {
      const http = {
        post: jest.fn().mockReturnValue(of({ data: { access_token: 'token' }, headers: {} })),
        get: jest
          .fn()
          .mockReturnValue(of({ data: [{ codia: 170001, prices_from: 2010, prices_to: to }], headers: {} })),
      }
      const service = new InfoAutoService(http as any, config as any, status as any)
      const result = service.validateVehicleYear(type, 17, 170001, year)
      if (valid) await expect(result).resolves.toBeUndefined()
      else await expect(result).rejects.toMatchObject({ status: 400 })
    } finally {
      jest.useRealTimers()
    }
  })

  // InfoAuto lists brand-new versions (e.g. KYMCO SKYTOWN 150) with no used-price
  // range but with a 0km list price. Triunfo prices them for the current year only.
  it.each([
    [VehicleType.MOTO, 2026, true, true, undefined],
    [VehicleType.MOTO, 2025, true, false, 'solo como 0km 2026'],
    [VehicleType.MOTO, 2027, true, false, 'solo como 0km 2026'],
    [VehicleType.AUTO, 2026, true, true, undefined],
    // Discontinued versions with no price at all still get RC from Triunfo.
    [VehicleType.MOTO, 2026, false, true, undefined],
    [VehicleType.AUTO, 1996, false, true, undefined],
  ])(
    'validates %s year %i for a version without used-price range (list_price=%s)',
    async (type, year, listPrice, valid, message) => {
      jest.useFakeTimers({ now: new Date('2026-09-30T12:00:00Z') })
      try {
        const http = {
          post: jest.fn().mockReturnValue(of({ data: { access_token: 'token' }, headers: {} })),
          get: jest.fn().mockReturnValue(
            of({
              data: [{ codia: 9500084, prices_from: null, prices_to: null, prices: false, list_price: listPrice }],
              headers: {},
            }),
          ),
        }
        const service = new InfoAutoService(http as any, config as any, status as any)
        const result = service.validateVehicleYear(type, 950, 9500084, year)
        if (valid) await expect(result).resolves.toBeUndefined()
        else {
          await expect(result).rejects.toMatchObject({ status: 400 })
          await expect(result).rejects.toThrow(message as string)
        }
      } finally {
        jest.useRealTimers()
      }
    },
  )

  describe('Status section', () => {
    const httpError = (status: number, data: unknown = '') =>
      new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
        status,
        statusText: '',
        data,
        headers: {},
        config: { headers: new AxiosHeaders() },
      })
    const loggedIn = () => of({ data: { access_token: 'token' }, headers: {} })

    it('reports a working catalog', async () => {
      const http = { post: jest.fn(loggedIn), get: jest.fn().mockReturnValue(of({ data: [], headers: {} })) }
      const service = new InfoAutoService(http as any, config as any, status as any)

      await service.getBrands(VehicleType.AUTO, {} as any)

      expect(status.succeeded).toHaveBeenCalledWith('infoauto.cars')
      expect(status.failed).not.toHaveBeenCalled()
    })

    it('takes a 404 for a model that does not exist as the catalog answering', async () => {
      const http = { post: jest.fn(loggedIn), get: jest.fn(() => throwError(() => httpError(404))) }
      const service = new InfoAutoService(http as any, config as any, status as any)

      await expect(service.getBrandModels(VehicleType.MOTO, 999, {} as any)).rejects.toBeInstanceOf(BadGatewayException)

      expect(status.succeeded).toHaveBeenCalledWith('infoauto.motorcycles')
      expect(status.failed).not.toHaveBeenCalled()
    })

    it('reports a 502 as the catalog failing', async () => {
      const http = { post: jest.fn(loggedIn), get: jest.fn(() => throwError(() => httpError(502, '<html>502</html>'))) }
      const service = new InfoAutoService(http as any, config as any, status as any)

      await expect(service.getBrands(VehicleType.AUTO, {} as any)).rejects.toBeInstanceOf(BadGatewayException)

      expect(status.failed).toHaveBeenCalledWith(
        'infoauto.cars',
        expect.objectContaining({ kind: 'HTTP_ERROR', httpStatus: 502, sample: '<html>502</html>' }),
      )
    })

    it('reports a refused login as the platform credentials', async () => {
      const http = { post: jest.fn(() => throwError(() => httpError(401))), get: jest.fn() }
      const service = new InfoAutoService(http as any, config as any, status as any)

      await expect(service.getBrands(VehicleType.AUTO, {} as any)).rejects.toBeInstanceOf(BadGatewayException)

      expect(status.failed).toHaveBeenCalledWith(
        'infoauto.cars',
        expect.objectContaining({ kind: 'CREDENTIALS_REJECTED', httpStatus: 401 }),
      )
      expect(http.get).not.toHaveBeenCalled()
    })
  })
})
