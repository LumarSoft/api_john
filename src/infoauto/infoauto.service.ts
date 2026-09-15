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
  email: string
  password: string
  cachedToken: string | null
  tokenExpiresAt: number | null
}

// The two InfoAuto products use different feature catalogs. Cars encode
// "Importado" as a choice; motorcycles encode it as a boolean.
const ORIGIN_FEATURE_ID: Record<VehicleType, number> = {
  [VehicleType.AUTO]: 21,
  [VehicleType.MOTO]: 15,
}

@Injectable()
export class InfoAutoService {
  private readonly logger = new Logger(InfoAutoService.name)

  private readonly pricesEnabled: boolean
  private readonly catalogs: Partial<Record<VehicleType, CatalogConfig>>

  // The catalog is static between monthly publications, so the origin of a
  // given codia never changes within a process lifetime.
  private readonly originCache = new Map<string, 'N' | 'I'>()

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // The subscription covers the catalog but not the valuation: list_price,
    // prices, photos, batch and archives all return 403 in production.
    this.pricesEnabled = this.configService.get<string>('INFOAUTO_PRICES_ENABLED') === 'true'

    this.catalogs = {
      [VehicleType.AUTO]: {
        baseUrl: this.configService.getOrThrow<string>('INFOAUTO_BASE_URL'),
        authUrl: this.configService.getOrThrow<string>('INFOAUTO_AUTH_URL'),
        email: this.configService.getOrThrow<string>('INFOAUTO_EMAIL'),
        password: this.configService.getOrThrow<string>('INFOAUTO_PASSWORD'),
        cachedToken: null,
        tokenExpiresAt: null,
      },
    }

    // Motorcycles have a separate subscription and credentials. Keep this
    // catalog optional so deployments without it return 503 for moto requests.
    const motoBaseUrl = this.configService.get<string>('INFOAUTO_MOTO_BASE_URL')
    const motoAuthUrl = this.configService.get<string>('INFOAUTO_MOTO_AUTH_URL')
    if (motoBaseUrl && motoAuthUrl) {
      this.catalogs[VehicleType.MOTO] = {
        baseUrl: motoBaseUrl,
        authUrl: motoAuthUrl,
        email: this.configService.getOrThrow<string>('INFOAUTO_MOTO_EMAIL'),
        password: this.configService.getOrThrow<string>('INFOAUTO_MOTO_PASSWORD'),
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
        { auth: { username: catalog.email, password: catalog.password } },
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
      this.logger.error(`InfoAuto ${type} login failed → ${status} (check catalog credentials)`)
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
   * Vehicle origin for Triunfo's `Origen` field. Cars use feature 21 (NO/SI);
   * motorcycles use feature 15 (false/true).
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
      const featureId = ORIGIN_FEATURE_ID[type]
      const feature = Array.isArray(data) ? data.find(f => Number(f.id) === featureId) : undefined

      if (!feature) {
        this.logger.debug(`Codia ${codia} has no feature ${featureId} — assuming Origen "N"`)
        return 'N'
      }

      const origin =
        type === VehicleType.MOTO
          ? feature.value === true || String(feature.value).toLowerCase() === 'true'
            ? 'I'
            : 'N'
          : String(feature.value).toUpperCase() === 'NO'
            ? 'N'
            : 'I'
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
