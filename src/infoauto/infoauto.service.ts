import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { AxiosError } from 'axios'
import { firstValueFrom } from 'rxjs'
import { InfoAutoQueryDto } from './dto/infoauto-query.dto'
import { VehicleType } from './infoauto.types'

interface InfoAutoUsedPrice {
  year: number
  price?: number
}

interface InfoAutoFeature {
  id: number
  value?: string | number | boolean
  value_description?: string
}

interface CatalogConfig {
  baseUrl: string
  authUrl: string
  cachedToken: string | null
  tokenExpiresAt: number | null
}

// InfoAuto feature that carries the vehicle origin. Values: NO = Nacional /
// Mercosur, SI = Internacional, MX = Mexico, CH = China. Triunfo only accepts
// N or I, so anything other than NO maps to "I".
const ORIGIN_FEATURE_ID = 21

@Injectable()
export class InfoAutoService {
  private readonly logger = new Logger(InfoAutoService.name)

  private readonly email: string
  private readonly password: string
  private readonly pricesEnabled: boolean
  private readonly catalogs: Partial<Record<VehicleType, CatalogConfig>>

  // The catalog is static between monthly publications, so the origin of a
  // given codia never changes within a process lifetime.
  private readonly originCache = new Map<string, 'N' | 'I'>()

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.email = this.configService.getOrThrow<string>('INFOAUTO_EMAIL')
    this.password = this.configService.getOrThrow<string>('INFOAUTO_PASSWORD')

    // The subscription covers the catalog but not the valuation: list_price,
    // prices, photos, batch and archives all return 403 in production.
    this.pricesEnabled = this.configService.get<string>('INFOAUTO_PRICES_ENABLED') === 'true'

    this.catalogs = {
      [VehicleType.AUTO]: {
        baseUrl: this.configService.getOrThrow<string>('INFOAUTO_BASE_URL'),
        authUrl: this.configService.getOrThrow<string>('INFOAUTO_AUTH_URL'),
        cachedToken: null,
        tokenExpiresAt: null,
      },
    }

    // Motorcycles are a separate InfoAuto product and are not contracted:
    // production answers 401 "Username not found" on /motorcycles/auth/login.
    // The catalog is only wired up if both URLs are present, so a MOTO request
    // fails with a clear 503 instead of a confusing upstream 401.
    const motoBaseUrl = this.configService.get<string>('INFOAUTO_MOTO_BASE_URL')
    const motoAuthUrl = this.configService.get<string>('INFOAUTO_MOTO_AUTH_URL')
    if (motoBaseUrl && motoAuthUrl) {
      this.catalogs[VehicleType.MOTO] = {
        baseUrl: motoBaseUrl,
        authUrl: motoAuthUrl,
        cachedToken: null,
        tokenExpiresAt: null,
      }
    } else {
      this.logger.warn('InfoAuto MOTO catalog is not configured — motorcycle quotes are unavailable')
    }
  }

  private catalog(type: VehicleType): CatalogConfig {
    const catalog = this.catalogs[type]
    if (!catalog) {
      throw new ServiceUnavailableException(`El catálogo de InfoAuto para ${type} no está disponible`)
    }
    return catalog
  }

  isAvailable(type: VehicleType): boolean {
    return Boolean(this.catalogs[type])
  }

  private async getToken(type: VehicleType): Promise<string> {
    const catalog = this.catalog(type)
    if (catalog.cachedToken && catalog.tokenExpiresAt && Date.now() < catalog.tokenExpiresAt) {
      return catalog.cachedToken
    }

    this.logger.log(`Refreshing InfoAuto ${type} token...`)

    const response = await firstValueFrom(
      this.httpService.post<{ access_token: string }>(
        `${catalog.authUrl}/login`,
        {},
        { auth: { username: this.email, password: this.password } },
      ),
    )

    const token = response.data?.access_token
    if (!token) throw new BadGatewayException('InfoAuto API error')

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    catalog.tokenExpiresAt = (payload.exp - 300) * 1000
    catalog.cachedToken = token

    return token
  }

  private parsePagination(raw: string | undefined) {
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  private async get<T>(type: VehicleType, path: string, params?: Record<string, unknown>) {
    // An unconfigured catalog is a 503 of our own — let it propagate untouched
    const catalog = this.catalog(type)

    // Resolved outside the GET's try so a failed login is not reported as a failed GET
    let token: string
    try {
      token = await this.getToken(type)
    } catch (error) {
      const status = error instanceof AxiosError ? (error.response?.status ?? error.code) : 'unknown'
      this.logger.error(`InfoAuto ${type} login failed → ${status} (check INFOAUTO_EMAIL / INFOAUTO_PASSWORD)`)
      throw new BadGatewayException('InfoAuto API error')
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(`${catalog.baseUrl}${path}`, {
          params,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      return {
        data: response.data,
        pagination: this.parsePagination(response.headers['x-pagination'] as string),
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.warn(`InfoAuto ${type} GET ${path} failed → ${error.response?.status ?? error.code ?? 'unknown'}`)
        throw new BadGatewayException('InfoAuto API error')
      }
      throw error
    }
  }

  getBrands(type: VehicleType, query: InfoAutoQueryDto) {
    return this.get(type, '/brands/', { ...query })
  }

  getGroups(type: VehicleType, brandId: number, query: InfoAutoQueryDto) {
    return this.get(type, `/brands/${brandId}/groups/`, { ...query })
  }

  getModels(type: VehicleType, brandId: number, groupId: number, query: InfoAutoQueryDto) {
    return this.get(type, `/brands/${brandId}/groups/${groupId}/models/`, { ...query })
  }

  /**
   * Vehicle origin for Triunfo's `Origen` field, read from InfoAuto feature 21
   * ("Importado"). Verified against the cartera: codia 120053 has feature 21 =
   * NO and its Triunfo policy carries Origen "N".
   *
   * Defaults to "N" when the feature is missing or the lookup fails — the vast
   * majority of the insured fleet is national, and a failed catalog read must
   * not block a quote.
   */
  async getVehicleOrigin(type: VehicleType, codia: number): Promise<'N' | 'I'> {
    const key = `${type}:${codia}`
    const cached = this.originCache.get(key)
    if (cached) return cached

    try {
      const { data } = await this.get<InfoAutoFeature[]>(type, `/models/${codia}/features/`)
      const feature = Array.isArray(data) ? data.find(f => Number(f.id) === ORIGIN_FEATURE_ID) : undefined

      if (!feature) {
        this.logger.debug(`Codia ${codia} has no feature ${ORIGIN_FEATURE_ID} — assuming Origen "N"`)
        return 'N'
      }

      const origin = String(feature.value).toUpperCase() === 'NO' ? 'N' : 'I'
      this.originCache.set(key, origin)
      return origin
    } catch {
      this.logger.warn(`Could not resolve origin for codia ${codia} — assuming Origen "N"`)
      return 'N'
    }
  }

  /**
   * Market value of a vehicle, for Triunfo's `Valor` field.
   *
   * Disabled by default: the InfoAuto subscription does not include valuation
   * (`/list_price` and `/prices/` both answer 403 in production), so this would
   * burn two failing requests per quote. Returning null makes the cotizador
   * send `Valor: "0"`, which tells Triunfo to resolve the market value with its
   * own InfoAuto subscription and hand it back in DatosAdicionales.ValorVehiculo.
   *
   * Set INFOAUTO_PRICES_ENABLED=true once valuation is contracted. Before
   * trusting the number, confirm the unit: the OpenAPI spec does not state
   * whether prices come in pesos or thousands of pesos. Compare against the
   * ValorVehiculo that Triunfo returns for the same vehicle and adjust the
   * multiplier below.
   */
  async getVehicleValue(type: VehicleType, codia: number, year: number): Promise<string | null> {
    if (!this.pricesEnabled) return null

    const currentYear = new Date().getFullYear()

    try {
      if (year < currentYear) {
        const { data } = await this.get<InfoAutoUsedPrice[]>(type, `/models/${codia}/prices/`)
        const match = Array.isArray(data) ? data.find(p => p.year === year) : undefined
        if (match?.price) return (match.price * 1000).toFixed(2)
      }

      const { data } = await this.get<{ list_price?: number }>(type, `/models/${codia}/list_price`)
      return data?.list_price ? (data.list_price * 1000).toFixed(2) : null
    } catch {
      this.logger.warn(`Could not resolve ${type} value for codia ${codia} (year ${year})`)
      return null
    }
  }
}
