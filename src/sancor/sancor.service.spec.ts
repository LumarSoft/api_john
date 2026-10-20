import { of, throwError } from 'rxjs'
import { AxiosError, AxiosHeaders } from 'axios'
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
import { SancorService } from './sancor.service'
import type { SancorVehicleQuotation } from './sancor.types'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'

const BASE = 'https://sancor.test/apissa/pre-catalog'
const ENV: Record<string, string> = {
  SANCOR_BASE_URL: BASE,
  SANCOR_CLIENT_ID: 'client-id',
  SANCOR_USERNAME: 'usuario',
  SANCOR_PASSWORD: 'clave',
  SANCOR_APP_CLIENT: 'john',
  SANCOR_PRODUCER_CODE: '1234',
  SANCOR_ORGANIZER_CODE: '5678',
}

const QUOTATION: SancorVehicleQuotation = {
  person: { identificationNumber: 30111222, identificationType: 'D', isJuridicPerson: false },
  currencyCode: 1,
  policyPeriodStartEffectiveDate: '2026-11-01T00:00:00',
  policyVigencyCode: 1,
  policyPaymentPeriodicityCode: 5,
  policyQuotas: 12,
  productCode: 24,
  zone: { postalCode: 2000 },
  vehicle: {
    vehicleCode: '180123',
    vehicleYear: 2020,
    yearSuggestedValue: 0,
    vehicleUseTypeCode: 2,
    vehicleTrackingEquipment: false,
    assistance: { assistance: 'sa_02', assistanceProvider: 'ibero' },
  },
}

function createService(http: Partial<Record<'post' | 'request', jest.Mock>>, env = ENV) {
  const config = { get: (key: string, fallback?: string) => env[key] ?? fallback } as unknown as ConfigService
  return new SancorService(http as unknown as HttpService, config)
}

function tokenResponse(token = 'tok', expiresIn = 3600) {
  return of({ status: 200, data: { access_token: token, expires_in: expiresIn, token_type: 'Bearer' } })
}

function httpError(status: number, data: unknown) {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers,
    config: { headers },
  })
}

describe('SancorService.getToken', () => {
  it('asks the auth0 token with the intermediary user and the portal client id', async () => {
    const post = jest.fn().mockReturnValue(tokenResponse())
    expect(await createService({ post }).getToken()).toBe('tok')

    expect(post).toHaveBeenCalledWith(
      `${BASE}/v2/security/auth0/token`,
      { username: 'usuario', password: 'clave', app_client: 'john' },
      expect.objectContaining({ headers: { gss_apiclient_id: 'client-id', 'X-IBM-Client-Id': 'client-id' } }),
    )
  })

  it('reuses the token while it is alive and shares one request between concurrent callers', async () => {
    const post = jest.fn().mockReturnValue(tokenResponse())
    const service = createService({ post })

    await Promise.all([service.getToken(), service.getToken()])
    await service.getToken()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('reports why Sancor refused the intermediary user', async () => {
    const post = jest
      .fn()
      .mockReturnValue(
        throwError(() =>
          httpError(403, { error: 'invalid_grant', error_description: 'Usuario o contraseña incorrecta.' }),
        ),
      )

    await expect(createService({ post }).getToken()).rejects.toThrow(
      'No se pudo obtener token de Sancor — HTTP 403 — Usuario o contraseña incorrecta.',
    )
  })

  it('refuses to call Sancor until the credentials are configured', async () => {
    const post = jest.fn()
    const service = createService({ post }, { SANCOR_BASE_URL: BASE })

    expect(service.isConfigured).toBe(false)
    await expect(service.getToken()).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('SancorService authenticated calls', () => {
  it('searches policies with the bearer token and only the filters given', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: { policies: [{ referenceNumber: '99' }] } }))
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    expect(await service.searchPolicies({ identificationNumber: 30111222, isVigent: true })).toEqual([
      { referenceNumber: '99' },
    ])
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: `${BASE}/policies`,
        params: { identificationNumber: 30111222, isVigent: true },
        headers: { gss_apiclient_id: 'client-id', 'X-IBM-Client-Id': 'client-id', Authorization: 'Bearer tok' },
      }),
    )
  })

  it('treats 204 as nothing found', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 204, data: '' }))
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    expect(await service.getPolicyDocuments({ branchCode: 4, reportName: 'Mercosur', officialNumber: '1' })).toEqual([])
  })

  it('lists claims of the configured producer code', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: { claim: { claimDescription: 'choque' } } }))
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    expect(await service.listClaims({ branchCode: 4, claimReportedDateSince: '2026-10-01' })).toEqual([
      { claimDescription: 'choque' },
    ])
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: `${BASE}/intermediaries/1234/claims/list`,
        data: { claim: { branchCode: 4, claimReportedDateSince: '2026-10-01' } },
      }),
    )
  })

  it('reports Sancor messages and forgets a token Sancor rejects', async () => {
    const post = jest.fn().mockReturnValueOnce(tokenResponse('old')).mockReturnValueOnce(tokenResponse('new'))
    const request = jest
      .fn()
      .mockReturnValueOnce(throwError(() => httpError(401, { messages: [{ code: '401', text: 'Token inválido' }] })))
      .mockReturnValueOnce(of({ status: 200, data: { policies: [] } }))
    const service = createService({ post, request })

    await expect(service.searchPolicies({ licensePlate: 'AA000AA' })).rejects.toThrow(
      new BadGatewayException('Sancor GET /policies falló — HTTP 401 — 401 Token inválido'),
    )
    await service.searchPolicies({ licensePlate: 'AA000AA' })
    expect(request.mock.calls[1][0].headers.Authorization).toBe('Bearer new')
  })
})

describe('SancorService.quoteVehicle', () => {
  it('wraps the auto quotation and fills in the producer and organizer codes', async () => {
    const plans = [{ module: { coverageName: 'C' }, premium: 1000 }]
    const request = jest
      .fn()
      .mockReturnValue(of({ status: 200, data: { vehicleQuotation: { quotationCode: 7, plans } } }))
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    expect(await service.quoteVehicle('automotive', QUOTATION)).toEqual({ quotationCode: 7, plans })
    const { url, data } = request.mock.calls[0][0]
    expect(url).toBe(`${BASE}/quotations/vehicle/automotive`)
    expect(data.vehicleQuotation.intermediary).toEqual({ prodProducerCode: 1234, upperProducerCode: 5678 })
    expect(data.vehicleQuotation.vehicle.assistance).toEqual({ assistance: 'sa_02', assistanceProvider: 'ibero' })
  })

  it('sends the moto quotation unwrapped with the "assistence" spelling', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: { vehicleQuotation: { plans: [] } } }))
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    await service.quoteVehicle('motorcycle', QUOTATION)
    const { url, data } = request.mock.calls[0][0]
    expect(url).toBe(`${BASE}/quotations/vehicle/motorcycle`)
    expect(data.vehicleQuotation).toBeUndefined()
    expect(data.vehicle.assistance).toBeUndefined()
    expect(data.vehicle.assistence).toEqual({ assistence: 'sa_02', assistenceProvider: 'ibero' })
  })
})
