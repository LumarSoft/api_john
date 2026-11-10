import { of, throwError } from 'rxjs'
import { AxiosError, AxiosHeaders } from 'axios'
import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { SancorService, sancorToday } from './sancor.service'
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

  it('uses the id_token Sancor returns: the services refuse the access_token', async () => {
    const post = jest
      .fn()
      .mockReturnValue(
        of({ status: 200, data: { access_token: 'opaque', id_token: 'id.jwt.token', expires_in: 86400 } }),
      )

    expect(await createService({ post }).getToken()).toBe('id.jwt.token')
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

// Answers as Sancor preproduction gave them on 9/11/2026, trimmed to a few lines.
const ROSARIO = { cityId: 1240, zipCode: 2000 }

function withAnswer(data: unknown) {
  const request = jest.fn().mockReturnValue(of({ status: 200, data }))
  const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })
  return { service, request }
}

const coverage = (description: string, capital: number, monthlyPremium: number, detailType = 'Cobertura') => ({
  capital,
  description,
  detail: 'Prima',
  coverId: 1,
  monthlyPremium,
  premiomToValidity: monthlyPremium * 12,
  detailType,
})

describe('sancorToday', () => {
  it('is the UTC day: past 21:00 in Argentina Sancor already wants tomorrow', () => {
    expect(sancorToday(new Date('2026-11-09T21:20:00-03:00'))).toBe('2026-11-10')
    expect(sancorToday(new Date('2026-11-09T20:59:00-03:00'))).toBe('2026-11-09')
  })
})

describe('SancorService catalogs', () => {
  it('lists the modules the intermediary may quote, trimmed, asking Sancor once', async () => {
    const { service, request } = withAnswer({
      modules: [
        { id: 1, description: 'Plan 2000 ' },
        { id: 2, description: 'Plan 2600 ' },
      ],
    })

    expect(await service.getModules('bag')).toEqual([
      { id: 1, description: 'Plan 2000' },
      { id: 2, description: 'Plan 2600' },
    ])
    await service.getModules('bag')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: `${BASE}/modules/bag`,
        params: { producer: 1234, organizer: 5678 },
      }),
    )
  })

  it('takes the city of the postal code by name, and the first one without a name', async () => {
    const { service, request } = withAnswer({
      localities: [
        { cityId: '1239', cityName: 'LA CERAMICA Y CUYO', zipCode: '2000', stateName: 'Santa Fe' },
        { cityId: '1240', cityName: 'ROSARIO', zipCode: '2000', stateName: 'Santa Fe' },
      ],
    })

    expect(await service.resolveLocation(2000, 'Rosario')).toEqual({ cityId: 1240, zipCode: 2000 })
    expect(await service.resolveLocation(2000)).toEqual({ cityId: 1239, zipCode: 2000 })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].params).toEqual({ zipCode: 2000, countryCode: 'AR' })
  })

  it('refuses a postal code Sancor has no city for', async () => {
    const { service } = withAnswer({ localities: [] })

    await expect(service.resolveLocation(9999)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('SancorService product quotations', () => {
  it('quotes several bag plans in one call, with the organizer as text', async () => {
    const { service, request } = withAnswer({
      quotation: {
        relationQuotationId: 43545582,
        quotationId: 1777710952,
        plans: [
          {
            coveragesModules: 1,
            premiumMonthly: 30,
            premiumVigency: 360.23,
            coverageValues: [coverage('Objetos Diversos', 2000, 21.96), coverage('IVA General', 0, 4.69, 'Impuesto')],
          },
        ],
      },
    })

    const quotation = await service.quoteBag(ROSARIO, [1, 2])

    expect(request.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: `${BASE}/quotations/theft/protectedbag`,
        data: {
          organizerNumber: '5678',
          producerNumber: 1234,
          locationRisk: ROSARIO,
          offeringCode: '1,2',
          startEffectiveDate: sancorToday(),
        },
      }),
    )
    expect(quotation.quotationId).toBe(1777710952)
    expect(quotation.plans[0]).toEqual(expect.objectContaining({ module: 1, monthlyPremium: 30, termPremium: 360.23 }))
    expect(quotation.plans[0].coverages).toEqual([
      { description: 'Objetos Diversos', capital: 2000, monthlyPremium: 21.96, termPremium: 263.52, type: 'Cobertura' },
    ])
    expect(quotation.plans[0].lines).toHaveLength(2)
  })

  it('quotes the standard bicycle plans without naming a module, which Sancor rejects', async () => {
    const { service, request } = withAnswer({
      quotation: {
        plans: [{ coveragesModules: 4, premiumMonthly: 1520, premiumVigency: 18240.01, coverageValues: [] }],
      },
    })

    const quotation = await service.quoteBicycle(ROSARIO)

    expect(request.mock.calls[0][0].data).toEqual({
      producerNumber: 1234,
      organizerNumber: 5678,
      locationRisk: ROSARIO,
      startEffectiveDate: sancorToday(),
    })
    expect(quotation.plans.map(p => [p.module, p.monthlyPremium])).toEqual([[4, 1520]])
  })

  it('quotes home plans alone unless extras are asked, reading its own spelling', async () => {
    const { service, request } = withAnswer({
      protectedHome: {
        quotation: {
          id: 1140237624,
          currency: { id: 1, description: 'ARS' },
          plans: [
            {
              coveragesModules: 70,
              premioMensual: 7630,
              premioSegunVigencia: 91560,
              coverageValues: [coverage('Incendio Edificio', 21000000, 350)],
            },
          ],
        },
      },
    })

    const quotation = await service.quoteHomeProtected(ROSARIO, [70, 71])
    await service.quoteHomeProtected(ROSARIO, [70], [{ id: 1, option: 3 }])

    expect(request.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ offeringCode: [70, 71], aditionals: [{ id: 0, option: 0 }] }),
    )
    expect(request.mock.calls[1][0].data.aditionals).toEqual([{ id: 1, option: 3 }])
    expect(quotation.quotationId).toBe(1140237624)
    expect(quotation.plans[0]).toEqual(
      expect.objectContaining({ module: 70, monthlyPremium: 7630, termPremium: 91560 }),
    )
  })

  it('refuses to quote without a module for the products that need one', async () => {
    const { service, request } = withAnswer({})

    await expect(service.quoteBag(ROSARIO, [])).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.quoteHomeProtected(ROSARIO, [])).rejects.toBeInstanceOf(BadRequestException)
    expect(request).not.toHaveBeenCalled()
  })

  it('quotes personal accidents with the document, a dated start and the age range, reading amounts sent as text', async () => {
    const { service, request } = withAnswer({
      AP24Modulate: {
        relationQuotationId: 43545620,
        rank16To70: {
          premioMensual: 1467,
          premioSegunVigencia: 17602.25,
          quotationId: 425282768,
          success: true,
          validationResults: [{ errorMessage: 'El grupo estadístico es inexistente', level: 'Warning' }],
          finallyCalculationResult: [
            {
              capital: 8000000,
              descripcion: 'Muerte Accidental',
              primaMensual: '457.80',
              primaSegunVigencia: '5493.60',
              tipoDetalle: 'Cobertura',
            },
            {
              capital: 0,
              descripcion: 'Recargo administrativo',
              primaMensual: '132.76',
              primaSegunVigencia: '1593.14',
              tipoDetalle: 'RecargosComerciales',
            },
          ],
        },
      },
    })

    const quotation = await service.quotePersonalAccident({
      location: ROSARIO,
      module: 47,
      document: { number: 20999001, type: 'D' },
      couple: true,
    })

    const { url, data } = request.mock.calls[0][0]
    expect(url).toBe(`${BASE}/quotations/personalAccident/AP24Modulate`)
    expect(data).toEqual(
      expect.objectContaining({
        clientIdentify: { documentNumber: 20999001, documentType: 'D' },
        offeringCode: 47,
        startEffectiveDate: `${sancorToday()}T00:00:00.000Z`,
        producerNumber: 1234,
        organizerNumber: 5678,
      }),
    )
    expect(data.personInsured.rank).toEqual({
      rank16To70: { selected: true, quantity: 2, deathCoverAmount: { code: 1, value: 0 } },
    })
    expect(quotation).toEqual({
      quotationId: 425282768,
      relationQuotationId: 43545620,
      plans: [
        expect.objectContaining({
          module: 47,
          monthlyPremium: 1467,
          termPremium: 17602.25,
          coverages: [
            {
              description: 'Muerte Accidental',
              capital: 8000000,
              monthlyPremium: 457.8,
              termPremium: 5493.6,
              type: 'Cobertura',
            },
          ],
        }),
      ],
    })
  })

  it('reports a personal-accident quotation Sancor marks as failed', async () => {
    const { service } = withAnswer({
      AP24Modulate: {
        rank71To75: {
          success: false,
          validationResults: [{ errorMessage: 'Edad fuera de rango', level: 'Error' }],
        },
      },
    })

    await expect(
      service.quotePersonalAccident({
        location: ROSARIO,
        module: 47,
        document: { number: 20999001, type: 'D' },
        ageRange: '71-75',
      }),
    ).rejects.toThrow('Sancor no cotizó accidentes personales — Edad fuera de rango')
  })

  it('tells why Sancor rejected a quotation, from the help of its message', async () => {
    const request = jest.fn().mockReturnValue(
      throwError(() =>
        httpError(500, {
          messages: [
            {
              status: '',
              code: 'GSS-500-003',
              text: 'BusinessError',
              help: 'El producto no tiene módulos habilitados para cotizar',
            },
          ],
        }),
      ),
    )
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    await expect(service.quoteHomeProtected(ROSARIO, [78])).rejects.toThrow(
      'HTTP 500 — GSS-500-003 BusinessError El producto no tiene módulos habilitados para cotizar',
    )
  })

  it('reads a single message object, not only lists', async () => {
    const request = jest
      .fn()
      .mockReturnValue(
        throwError(() => httpError(404, { messages: { code: 'GSS-204-002', text: 'No se encontraron resultados.' } })),
      )
    const service = createService({ post: jest.fn().mockReturnValue(tokenResponse()), request })

    await expect(service.searchPolicies({ licensePlate: 'ZZ999ZZ' })).rejects.toThrow(
      'HTTP 404 — GSS-204-002 No se encontraron resultados.',
    )
  })
})
