import {
  BadGatewayException,
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
  SancorClaim,
  SancorClaimListFilters,
  SancorDocumentRequest,
  SancorFile,
  SancorMessage,
  SancorPolicy,
  SancorPolicyFilters,
  SancorQuotation,
  SancorTokenResponse,
  SancorVehicleKind,
  SancorVehicleQuotation,
} from './sancor.types'

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

    const token = data?.access_token
    if (!token) throw new UnauthorizedException('Sancor no devolvió access_token')

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

  private readCode(key: string): number | undefined {
    const value = Number(this.configService.get<string>(key))
    return Number.isInteger(value) && value > 0 ? value : undefined
  }

  // HTTP status plus Sancor's own messages; never the request, which carries credentials.
  private describeError(err: unknown): string {
    if (!(err instanceof AxiosError)) return err instanceof Error ? err.message : String(err)
    if (!err.response) return err.code ?? err.message

    // Sancor nests the list differently per API: messages[], message[] or messages[].message[].
    // The gateway answers { httpMessage, moreInformation } and the token API { error_description }.
    type Entry = SancorMessage & { message?: SancorMessage[] }
    const body = err.response.data as
      | { messages?: Entry[]; message?: Entry[]; moreInformation?: string; error_description?: string }
      | undefined
    const messages = [...(body?.messages ?? []), ...(body?.message ?? [])]
      .flatMap((m): SancorMessage[] => m.message ?? [m])
      .map(m => [m.code, m.text].filter(Boolean).join(' '))
      .concat(body?.error_description ?? [], body?.moreInformation ?? [])
      .filter(Boolean)
    return `HTTP ${err.response.status}${messages.length ? ` — ${messages.join('; ')}` : ''}`
  }
}
