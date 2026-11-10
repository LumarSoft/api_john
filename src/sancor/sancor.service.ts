import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { AxiosError, type AxiosRequestConfig } from 'axios'
import { firstValueFrom } from 'rxjs'
import type {
  SancorAccidentAgeRange,
  SancorAccidentQuotationInput,
  SancorClaim,
  SancorClaimListFilters,
  SancorDocumentRequest,
  SancorFile,
  SancorHomeAdditional,
  SancorLocality,
  SancorLocation,
  SancorMessage,
  SancorModule,
  SancorModuleProduct,
  SancorPolicy,
  SancorPolicyFilters,
  SancorProductPlan,
  SancorProductQuotation,
  SancorQuotation,
  SancorQuoteLine,
  SancorTokenResponse,
  SancorVehicleKind,
  SancorVehicleQuotation,
} from './sancor.types'

/**
 * The start date every Sancor quotation takes. Sancor only quotes "today" and
 * reads today in UTC: at 21:20 in Argentina on 9/11/2026 it refused
 * 2026-11-09 ("Solo se permite cotizar a la fecha actual") and took 2026-11-10.
 */
export function sancorToday(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// Plans as the bag, bicycle and home APIs answer them; each spells the totals its own way.
interface RawCoverageValue {
  capital?: number | string
  description?: string
  monthlyPremium?: number | string
  premiomToValidity?: number | string
  detailType?: string
}

interface RawPlan {
  coveragesModules?: number
  premiumMonthly?: number
  premiumVigency?: number
  premioMensual?: number
  premioSegunVigencia?: number
  coverageValues?: RawCoverageValue[]
}

interface RawQuotation {
  quotationId?: number
  // Hogar Protegido calls the quotation id "id".
  id?: number
  relationQuotationId?: number
  plans?: RawPlan[]
}

// One age range of a personal-accident quotation: amounts come as strings.
interface RawAccidentRange {
  premioMensual?: number | string
  premioSegunVigencia?: number | string
  quotationId?: number
  success?: boolean
  validationResults?: Array<{ errorMessage?: string; level?: string }>
  finallyCalculationResult?: Array<{
    capital?: number | string
    descripcion?: string
    primaMensual?: number | string
    primaSegunVigencia?: number | string
    tipoDetalle?: string
  }>
}

const AGE_RANGE_KEYS: Record<SancorAccidentAgeRange, string> = {
  '16-70': 'rank16To70',
  '71-75': 'rank71To75',
  '76+': 'rank76To800',
}

/**
 * Hogar Protegido refuses a quotation without extras (415 "Faltan parámetros de
 * entrada obligatorios"); this one prices the plan alone: 7630 a month for
 * module 70 against 9120 with extra 1 option 3 (9/11/2026).
 */
const NO_HOME_ADDITIONAL: SancorHomeAdditional = { id: 0, option: 0 }

const toNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Case and accents aside, for matching a city name.
const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Client for the Sancor Seguros APIs published on their IBM API Connect portal
 * (docs/sancor-services.md). Every call carries the portal app's client id, and
 * every call but the token one also carries the intermediary's Auth0 token.
 *
 * Only reads and quotations live here. Issuing, annulling and reporting claims
 * create real records at Sancor and are left to a deliberate follow-up.
 */
@Injectable()
export class SancorService {
  private readonly logger = new Logger(SancorService.name)
  private cachedToken: string | null = null
  private tokenExpiresAt: number | null = null
  // Shared promise so N concurrent callers trigger ONE token request, not N.
  private tokenInFlight: Promise<string> | null = null

  // Renew this long before the real expiry, so a request never travels with a
  // token that dies mid-flight.
  private static readonly TOKEN_MARGIN_MS = 5 * 60 * 1000
  // Used when Sancor omits expires_in; their example says 3600 s.
  private static readonly DEFAULT_TOKEN_LIFE_S = 3600
  private static readonly TOKEN_TIMEOUT_MS = 30_000
  private static readonly REQUEST_TIMEOUT_MS = 15_000
  private static readonly QUOTATION_TIMEOUT_MS = 30_000
  // Modules and localities barely change, and every product plan allows only
  // 100 calls an hour: they are asked once every few hours.
  private static readonly CATALOG_TTL_MS = 6 * 60 * 60 * 1000

  private readonly catalogCache = new Map<string, { value: unknown; expiresAt: number }>()

  private readonly baseUrl: string
  private readonly clientId?: string
  private readonly username?: string
  private readonly password?: string
  private readonly appClient?: string
  private readonly producerCode?: number
  private readonly organizerCode?: number

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Not getOrThrow: the API must boot while Sancor credentials are still pending.
    this.baseUrl = this.configService.get<string>(
      'SANCOR_BASE_URL',
      'https://external-pre-api.gruposancorseguros.com/apissa/pre-catalog',
    )
    this.clientId = this.configService.get<string>('SANCOR_CLIENT_ID') || undefined
    this.username = this.configService.get<string>('SANCOR_USERNAME') || undefined
    this.password = this.configService.get<string>('SANCOR_PASSWORD') || undefined
    this.appClient = this.configService.get<string>('SANCOR_APP_CLIENT') || undefined
    this.producerCode = this.readCode('SANCOR_PRODUCER_CODE')
    this.organizerCode = this.readCode('SANCOR_ORGANIZER_CODE')
  }

  /** True once the portal app and the intermediary user are configured. */
  get isConfigured(): boolean {
    return Boolean(this.clientId && this.username && this.password)
  }

  /**
   * Returns a valid Auth0 token for the intermediary, asking Sancor only when
   * the cached one is missing or about to expire.
   */
  async getToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    // Another caller is already fetching — wait for that same promise.
    if (this.tokenInFlight) return this.tokenInFlight

    this.tokenInFlight = this.renewToken().finally(() => {
      this.tokenInFlight = null
    })
    return this.tokenInFlight
  }

  private async renewToken(): Promise<string> {
    this.assertConfigured()
    this.logger.log('Renovando token de Sancor...')

    let data: SancorTokenResponse | undefined
    try {
      const response = await firstValueFrom(
        this.httpService.post<SancorTokenResponse>(
          `${this.baseUrl}/v2/security/auth0/token`,
          {
            username: this.username,
            password: this.password,
            ...(this.appClient ? { app_client: this.appClient } : {}),
          },
          { headers: this.clientHeaders(), timeout: SancorService.TOKEN_TIMEOUT_MS },
        ),
      )
      data = response.data
    } catch (err) {
      throw new UnauthorizedException(`No se pudo obtener token de Sancor — ${this.describeError(err)}`)
    }

    // The login answers two tokens and the services take the id_token: with
    // the access_token the cartera, the claims and the token validation answer
    // 401 (first real calls, 9/11/2026). The access_token stays as a fallback.
    const token = data?.id_token || data?.access_token
    if (!token) throw new UnauthorizedException('Sancor no devolvió un token')

    const lifeSeconds = Number(data?.expires_in) || SancorService.DEFAULT_TOKEN_LIFE_S
    this.cachedToken = token
    this.tokenExpiresAt = Date.now() + lifeSeconds * 1000 - SancorService.TOKEN_MARGIN_MS
    return token
  }

  /** Policies of the intermediary matching the filters (by DNI, CUIT, plate, policy number…). */
  async searchPolicies(filters: SancorPolicyFilters): Promise<SancorPolicy[]> {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined))
    const data = await this.request<{ policies?: SancorPolicy[] }>({ method: 'GET', url: '/policies', params })
    return data?.policies ?? []
  }

  /** One document of a policy (carátula, tarjeta Mercosur, factura, certificado de pago…). */
  async getPolicyDocuments(document: SancorDocumentRequest): Promise<SancorFile[]> {
    const data = await this.request<{ files?: SancorFile[] }>({
      method: 'POST',
      url: '/policies/document/file/get',
      data: { file: document },
    })
    return data?.files ?? []
  }

  /** Documents Sancor holds for a claim. */
  async getClaimDocuments(claimNumber: string): Promise<SancorFile[]> {
    const data = await this.request<{ files?: SancorFile[] }>({
      method: 'GET',
      url: '/policies/document/file/claim',
      params: { claimNumber },
    })
    return data?.files ?? []
  }

  /** Claims of the intermediary for a branch, at most one month back. */
  async listClaims(filters: SancorClaimListFilters, producerCode = this.requireProducerCode()): Promise<SancorClaim[]> {
    const data = await this.request<{ claim?: SancorClaim | SancorClaim[]; claims?: SancorClaim[] }>({
      method: 'POST',
      url: `/intermediaries/${producerCode}/claims/list`,
      data: { claim: filters },
    })
    // The spec types the list as a single "claim" object; accept either shape.
    if (Array.isArray(data?.claims)) return data.claims
    return data?.claim ? ([] as SancorClaim[]).concat(data.claim) : []
  }

  /** Full detail of one claim of the intermediary. */
  async getClaim(claimNumber: number, producerCode = this.requireProducerCode()): Promise<SancorClaim | null> {
    const data = await this.request<{ claim?: SancorClaim }>({
      method: 'GET',
      url: `/intermediaries/${producerCode}/claims/${claimNumber}`,
    })
    return data?.claim ?? null
  }

  /**
   * Quotes a car or a motorcycle. The body follows the auto spelling; the moto
   * API takes it unwrapped and spells the assistance block "assistence".
   */
  async quoteVehicle(kind: SancorVehicleKind, quotation: SancorVehicleQuotation): Promise<SancorQuotation> {
    const body = this.withIntermediary(quotation)
    const data = await this.request<{ vehicleQuotation?: SancorQuotation }>(
      {
        method: 'POST',
        url: `/quotations/vehicle/${kind}`,
        data: kind === 'automotive' ? { vehicleQuotation: body } : this.toMotorcycleBody(body),
      },
      SancorService.QUOTATION_TIMEOUT_MS,
    )
    return { ...data?.vehicleQuotation, plans: data?.vehicleQuotation?.plans ?? [] }
  }

  /** Sancor's cities for a postal code (several share one: 2000 is Rosario and its neighbourhoods). */
  async getLocalities(zipCode: number): Promise<SancorLocality[]> {
    return this.cached(`localities:${zipCode}`, async () => {
      const data = await this.request<{
        localities?: Array<{
          cityId?: number | string
          cityName?: string
          zipCode?: number | string
          stateName?: string
        }>
      }>({ method: 'GET', url: '/localities', params: { zipCode, countryCode: 'AR' } })
      return (data?.localities ?? [])
        .map(l => ({
          cityId: toNumber(l.cityId),
          cityName: (l.cityName ?? '').trim(),
          zipCode: toNumber(l.zipCode) || zipCode,
          ...(l.stateName ? { stateName: l.stateName.trim() } : {}),
        }))
        .filter(l => l.cityId > 0)
    })
  }

  /**
   * The location a quotation takes: the city of the postal code whose name
   * matches the one given, or the first one Sancor lists for that code.
   */
  async resolveLocation(zipCode: number, cityName?: string): Promise<SancorLocation> {
    const localities = await this.getLocalities(zipCode)
    if (!localities.length) {
      throw new BadRequestException(`Sancor no tiene localidades para el código postal ${zipCode}`)
    }
    const wanted = cityName ? fold(cityName) : ''
    const match =
      (wanted && localities.find(l => fold(l.cityName) === wanted)) ||
      (wanted && localities.find(l => fold(l.cityName).includes(wanted))) ||
      localities[0]
    return { cityId: match.cityId, zipCode }
  }

  /** The coverage modules (plans) the intermediary may quote for a product. */
  async getModules(product: SancorModuleProduct): Promise<SancorModule[]> {
    return this.cached(`modules:${product}`, async () => {
      const data = await this.request<{ modules?: Array<{ id?: number; description?: string }> }>({
        method: 'GET',
        url: `/modules/${product}`,
        params: {
          ...(this.producerCode ? { producer: this.producerCode } : {}),
          ...(this.organizerCode ? { organizer: this.organizerCode } : {}),
        },
      })
      return (data?.modules ?? [])
        .filter((m): m is { id: number; description?: string } => Number.isInteger(m.id))
        .map(m => ({ id: m.id, description: (m.description ?? '').trim() }))
    })
  }

  /** Robo Bolso Protegido: one plan per module asked, all in one call. */
  async quoteBag(location: SancorLocation, modules: number[]): Promise<SancorProductQuotation> {
    if (!modules.length) throw new BadRequestException('Indicá al menos un plan de bolso protegido')
    const data = await this.request<{ quotation?: RawQuotation }>(
      {
        method: 'POST',
        url: '/quotations/theft/protectedbag',
        data: {
          // This API takes the organizer as a string and the modules as "1,2,3".
          organizerNumber: String(this.requireOrganizerCode()),
          producerNumber: this.requireProducerCode(),
          locationRisk: location,
          offeringCode: modules.join(','),
          startEffectiveDate: sancorToday(),
        },
      },
      SancorService.QUOTATION_TIMEOUT_MS,
    )
    return this.toProductQuotation(data?.quotation)
  }

  /**
   * Robo Bicicleta. Asking for a module breaks it (500 "The complex type of
   * element CoverModuleCodes … must not have a value", 9/11/2026): without one
   * Sancor prices its standard plans, Plan 25.000 to Plan 100.000.
   */
  async quoteBicycle(location: SancorLocation): Promise<SancorProductQuotation> {
    const data = await this.request<{ quotation?: RawQuotation }>(
      {
        method: 'POST',
        url: '/quotations/theft/bicycle',
        data: {
          producerNumber: this.requireProducerCode(),
          organizerNumber: this.requireOrganizerCode(),
          locationRisk: location,
          startEffectiveDate: sancorToday(),
        },
      },
      SancorService.QUOTATION_TIMEOUT_MS,
    )
    return this.toProductQuotation(data?.quotation)
  }

  /**
   * Combinado Familiar Hogar Protegido: one plan per module asked. Modules the
   * intermediary does not sell are left out of the answer, and asking only for
   * those fails ("El producto no tiene módulos habilitados para cotizar").
   */
  async quoteHomeProtected(
    location: SancorLocation,
    modules: number[],
    additionals: SancorHomeAdditional[] = [],
  ): Promise<SancorProductQuotation> {
    if (!modules.length) throw new BadRequestException('Indicá al menos un plan de hogar')
    const data = await this.request<{ protectedHome?: { quotation?: RawQuotation } }>(
      {
        method: 'POST',
        url: '/quotations/familyCombined/homeProtected',
        data: {
          producerNumber: this.requireProducerCode(),
          organizerNumber: this.requireOrganizerCode(),
          locationRisk: location,
          offeringCode: modules,
          aditionals: additionals.length ? additionals : [NO_HOME_ADDITIONAL],
          startEffectiveDate: sancorToday(),
        },
      },
      SancorService.QUOTATION_TIMEOUT_MS,
    )
    return this.toProductQuotation(data?.protectedHome?.quotation)
  }

  /**
   * Accidentes Personales 24 hs, individual, yearly in 12 installments. The
   * module sets the capital (death and disability); the client's document is
   * required (without it Sancor fails building its request) and the dates
   * must carry a time.
   */
  async quotePersonalAccident(input: SancorAccidentQuotationInput): Promise<SancorProductQuotation> {
    const rangeKey = AGE_RANGE_KEYS[input.ageRange ?? '16-70']
    const data = await this.request<{ AP24Modulate?: Record<string, unknown> & { relationQuotationId?: number } }>(
      {
        method: 'POST',
        url: '/quotations/personalAccident/AP24Modulate',
        data: {
          // 1 individual policy, 1 annual term, 12 installments.
          policyTypeId: 1,
          periodOfValidityId: 1,
          feeId: 12,
          locationRisk: input.location,
          clientIdentify: { documentNumber: input.document.number, documentType: input.document.type },
          offeringCode: input.module,
          startEffectiveDate: `${sancorToday()}T00:00:00.000Z`,
          producerNumber: this.requireProducerCode(),
          organizerNumber: this.requireOrganizerCode(),
          respectClientIvaCondition: false,
          sealExemptActivity: false,
          personInsured: {
            rank: {
              [rangeKey]: {
                selected: true,
                quantity: input.couple ? 2 : 1,
                // Ignored: the module sets the capital. Sancor's request needs the block.
                deathCoverAmount: { code: 1, value: 0 },
              },
            },
          },
        },
      },
      SancorService.QUOTATION_TIMEOUT_MS,
    )
    const range = data?.AP24Modulate?.[rangeKey] as RawAccidentRange | undefined
    if (!range) return { relationQuotationId: data?.AP24Modulate?.relationQuotationId, plans: [] }

    const errors = (range.validationResults ?? [])
      .filter(r => r.level?.toLowerCase() === 'error' && r.errorMessage)
      .map(r => r.errorMessage)
    if (range.success === false || errors.length) {
      throw new BadGatewayException(`Sancor no cotizó accidentes personales — ${errors.join('; ') || 'sin detalle'}`)
    }
    const lines = (range.finallyCalculationResult ?? []).map(l =>
      this.toLine(l.descripcion, l.capital, l.primaMensual, l.primaSegunVigencia, l.tipoDetalle),
    )
    return {
      quotationId: range.quotationId,
      relationQuotationId: data?.AP24Modulate?.relationQuotationId,
      plans: [this.toPlan(input.module, range.premioMensual, range.premioSegunVigencia, lines)],
    }
  }

  private toProductQuotation(raw: RawQuotation | undefined): SancorProductQuotation {
    return {
      quotationId: raw?.quotationId ?? raw?.id,
      relationQuotationId: raw?.relationQuotationId,
      plans: (raw?.plans ?? []).map(plan =>
        this.toPlan(
          plan.coveragesModules,
          plan.premiumMonthly ?? plan.premioMensual,
          plan.premiumVigency ?? plan.premioSegunVigencia,
          (plan.coverageValues ?? []).map(c =>
            this.toLine(c.description, c.capital, c.monthlyPremium, c.premiomToValidity, c.detailType),
          ),
        ),
      ),
    }
  }

  private toPlan(module: unknown, monthly: unknown, term: unknown, lines: SancorQuoteLine[]): SancorProductPlan {
    return {
      module: toNumber(module),
      monthlyPremium: toNumber(monthly),
      termPremium: toNumber(term),
      coverages: lines.filter(l => l.type === 'Cobertura'),
      lines,
    }
  }

  private toLine(
    description: unknown,
    capital: unknown,
    monthly: unknown,
    term: unknown,
    type: unknown,
  ): SancorQuoteLine {
    return {
      description: String(description ?? '').trim(),
      capital: toNumber(capital),
      monthlyPremium: toNumber(monthly),
      termPremium: toNumber(term),
      type: String(type ?? ''),
    }
  }

  // A catalog answer kept for a few hours; an empty one is asked again next time.
  private async cached<T>(key: string, load: () => Promise<T[]>): Promise<T[]> {
    const hit = this.catalogCache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value as T[]
    const value = await load()
    if (value.length) {
      this.catalogCache.set(key, { value, expiresAt: Date.now() + SancorService.CATALOG_TTL_MS })
    }
    return value
  }

  private withIntermediary(quotation: SancorVehicleQuotation): SancorVehicleQuotation {
    return {
      ...quotation,
      intermediary: {
        prodProducerCode: this.producerCode,
        upperProducerCode: this.organizerCode,
        ...quotation.intermediary,
      },
    }
  }

  private toMotorcycleBody(quotation: SancorVehicleQuotation): Record<string, unknown> {
    const { assistance, ...vehicle } = quotation.vehicle
    return {
      ...quotation,
      vehicle: {
        ...vehicle,
        ...(assistance
          ? { assistence: { assistence: assistance.assistance, assistenceProvider: assistance.assistanceProvider } }
          : {}),
      },
    }
  }

  /**
   * One authenticated call. 204 means "nothing found" and comes back as null;
   * any other failure becomes a BadGatewayException carrying Sancor's messages.
   */
  private async request<T>(config: AxiosRequestConfig, timeout = SancorService.REQUEST_TIMEOUT_MS): Promise<T | null> {
    const token = await this.getToken()
    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({
          ...config,
          url: `${this.baseUrl}${config.url}`,
          headers: { ...this.clientHeaders(), Authorization: `Bearer ${token}` },
          timeout,
        }),
      )
      return response.status === 204 ? null : response.data
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        // A token Sancor no longer accepts must not be reused by the next call.
        this.cachedToken = null
        this.tokenExpiresAt = null
      }
      const detail = this.describeError(err)
      this.logger.warn(`Sancor ${config.method} ${config.url}: ${detail}`)
      throw new BadGatewayException(`Sancor ${config.method} ${config.url} falló — ${detail}`)
    }
  }

  private clientHeaders(): Record<string, string> {
    this.assertConfigured()
    // The spec names the header gss_apiclient_id; the portal manual calls it
    // X-IBM-Client-Id. API Connect accepts either, so both go.
    return { gss_apiclient_id: this.clientId!, 'X-IBM-Client-Id': this.clientId! }
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Sancor no está configurado (SANCOR_CLIENT_ID, SANCOR_USERNAME, SANCOR_PASSWORD)',
      )
    }
  }

  private requireProducerCode(): number {
    if (!this.producerCode) throw new ServiceUnavailableException('Falta SANCOR_PRODUCER_CODE')
    return this.producerCode
  }

  private requireOrganizerCode(): number {
    if (!this.organizerCode) throw new ServiceUnavailableException('Falta SANCOR_ORGANIZER_CODE')
    return this.organizerCode
  }

  private readCode(key: string): number | undefined {
    const value = Number(this.configService.get<string>(key))
    return Number.isInteger(value) && value > 0 ? value : undefined
  }

  // HTTP status plus Sancor's own messages; never the request, which carries credentials.
  private describeError(err: unknown): string {
    if (!(err instanceof AxiosError)) return err instanceof Error ? err.message : String(err)
    if (!err.response) return err.code ?? err.message

    // Sancor nests the list differently per API: messages[], message[], messages[].message[]
    // or a single messages object; errors[] in the claims APIs. The gateway answers
    // { httpMessage, moreInformation } and the token API { error_description }.
    type Entry = SancorMessage & { message?: SancorMessage[] }
    const body = err.response.data as
      | {
          messages?: Entry | Entry[]
          message?: Entry | Entry[]
          errors?: SancorMessage[]
          moreInformation?: string
          error_description?: string
        }
      | undefined
    const entries = ([] as Entry[]).concat(body?.messages ?? [], body?.message ?? [], body?.errors ?? [])
    const messages = entries
      .flatMap((m): SancorMessage[] => m.message ?? [m])
      // A rejected quotation tells why in "help" ("El producto no tiene módulos habilitados para cotizar").
      .map(m => [m.code, m.text, m.help && m.help !== m.text ? m.help : ''].filter(Boolean).join(' '))
      .concat(body?.error_description ?? [], body?.moreInformation ?? [])
      .filter(Boolean)
    return `HTTP ${err.response.status}${messages.length ? ` — ${messages.join('; ')}` : ''}`
  }
}
