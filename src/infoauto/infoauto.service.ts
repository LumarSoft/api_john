import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
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
  tokenInFlight: Promise<string> | null
}

// InfoAuto exposes origin differently in each catalog. Cars use feature 21
// (NO = Nacional/Mercosur; every other value = imported), while motorcycles
// use boolean feature 15 ("Importado"). Triunfo accepts only N or I.
const ORIGIN_FEATURE_ID: Record<VehicleType, number> = {
  [VehicleType.AUTO]: 21,
  [VehicleType.MOTO]: 15,
}

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
        email: this.email,
        password: this.password,
        cachedToken: null,
        tokenExpiresAt: null,
        tokenInFlight: null,
      },
    }

    // Motorcycles are a separate InfoAuto product and can use their own
    // credentials. The catalog is only wired up if both URLs are present, so a
    // MOTO request fails with a clear 503 when the product is not configured.
    const motoBaseUrl = this.configService.get<string>('INFOAUTO_MOTO_BASE_URL')
    const motoAuthUrl = this.configService.get<string>('INFOAUTO_MOTO_AUTH_URL')
    if (motoBaseUrl && motoAuthUrl) {
      this.catalogs[VehicleType.MOTO] = {
        baseUrl: motoBaseUrl,
        authUrl: motoAuthUrl,
        // InfoAuto can issue a separate motorcycle account. When it does not,
        // the shared catalog credentials remain the backwards-compatible path.
        email: this.configService.get<string>('INFOAUTO_MOTO_EMAIL') || this.email,
        password: this.configService.get<string>('INFOAUTO_MOTO_PASSWORD') || this.password,
        cachedToken: null,
        tokenExpiresAt: null,
        tokenInFlight: null,
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

    if (catalog.tokenInFlight) return catalog.tokenInFlight

    catalog.tokenInFlight = this.login(type, catalog).finally(() => {
      catalog.tokenInFlight = null
    })
    return catalog.tokenInFlight
  }

  private async login(type: VehicleType, catalog: CatalogConfig): Promise<string> {
    this.logger.log(`Refreshing InfoAuto ${type} token...`)

    const response = await firstValueFrom(
      this.httpService.post<{ access_token: string }>(
        `${catalog.authUrl}/login`,
        {},
        {
          auth: { username: catalog.email, password: catalog.password },
          timeout: 15_000,
        },
      ),
    )

    // Depending on the InfoAuto product/version, login returns the access
    // token in the JSON body or in X-Access-Token. Support both contracts.
    const headerToken = response.headers?.['x-access-token']
    const token = (Array.isArray(headerToken) ? headerToken[0] : headerToken) || response.data?.access_token
    if (!token) throw new BadGatewayException('InfoAuto API error')

    catalog.tokenExpiresAt = this.readTokenExpiry(token) ?? Date.now() + 55 * 60 * 1000
    catalog.cachedToken = token

    return token
  }

  private readTokenExpiry(token: string): number | null {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp?: number }
      return typeof payload.exp === 'number' ? (payload.exp - 300) * 1000 : null
    } catch {
      // Some InfoAuto environments return an opaque token. Cache it for less
      // than the documented hour rather than failing an otherwise valid login.
      return null
    }
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

  getBrandModels(type: VehicleType, brandId: number, query: InfoAutoQueryDto) {
    return this.get(type, `/brands/${brandId}/models/`, { ...query })
  }

  getModels(type: VehicleType, brandId: number, groupId: number, query: InfoAutoQueryDto) {
    return this.get(type, `/brands/${brandId}/groups/${groupId}/models/`, { ...query })
  }

  /** Check the catalog before Triunfo: it can price nonexistent model years. */
  async validateVehicleYear(type: VehicleType, brandId: number, codia: number, year: number): Promise<void> {
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) {
      throw new BadRequestException('Año del vehículo inválido')
    }
    for (let page = 1; ; page++) {
      const { data } = await this.get<Array<{ codia: number; prices_from?: number | null; prices_to?: number | null }>>(
        type,
        `/brands/${brandId}/models/`,
        { page, page_size: 100 },
      )
      if (!Array.isArray(data)) throw new BadGatewayException('No se pudo validar el vehículo en InfoAuto')
      const model = data.find(m => Number(m.codia) === codia)
      if (model) {
        const from = model.prices_from
        const to = model.prices_to
        // A recent motorcycle can still be sold as the current model year
        // while InfoAuto's annual publication catches up.
        const recentMoto = type === VehicleType.MOTO && typeof to === 'number' && to >= new Date().getFullYear() - 1
        if (typeof from !== 'number' || typeof to !== 'number') {
          throw new BadRequestException(
            'El catálogo no permite verificar el año de esta versión. Consultá con un asesor.',
          )
        }
        if (year < from || (year > to && !recentMoto)) {
          throw new BadRequestException(
            `El catálogo no lista esta versión para ${year}. Revisá el modelo y el año de la documentación.`,
          )
        }
        return
      }
      if (data.length < 100) break
    }
    throw new BadRequestException('No se encontró la versión del vehículo en el catálogo')
  }

  /**
   * Vehicle origin for Triunfo's `Origen` field. Cars use InfoAuto feature 21;
   * motorcycles use boolean feature 15. Verified against the production
   * contracts of both catalogs.
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

      const raw = String(feature.value).toUpperCase()
      const origin =
        type === VehicleType.MOTO
          ? feature.value === true || raw === 'TRUE' || raw === 'SI' || raw === '1'
            ? 'I'
            : 'N'
          : raw === 'NO'
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
