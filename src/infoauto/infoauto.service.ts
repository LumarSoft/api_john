import { BadGatewayException, Injectable, Logger } from '@nestjs/common'
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

interface CatalogConfig {
  baseUrl: string
  authUrl: string
  cachedToken: string | null
  tokenExpiresAt: number | null
}

@Injectable()
export class InfoAutoService {
  private readonly logger = new Logger(InfoAutoService.name)

  private readonly email: string
  private readonly password: string
  private readonly catalogs: Record<VehicleType, CatalogConfig>

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.email = this.configService.getOrThrow<string>('INFOAUTO_EMAIL')
    this.password = this.configService.getOrThrow<string>('INFOAUTO_PASSWORD')
    this.catalogs = {
      [VehicleType.AUTO]: {
        baseUrl: this.configService.getOrThrow<string>('INFOAUTO_BASE_URL'),
        authUrl: this.configService.getOrThrow<string>('INFOAUTO_AUTH_URL'),
        cachedToken: null,
        tokenExpiresAt: null,
      },
      [VehicleType.MOTO]: {
        baseUrl: this.configService.getOrThrow<string>('INFOAUTO_MOTO_BASE_URL'),
        authUrl: this.configService.getOrThrow<string>('INFOAUTO_MOTO_AUTH_URL'),
        cachedToken: null,
        tokenExpiresAt: null,
      },
    }
  }

  private async getToken(type: VehicleType): Promise<string> {
    const catalog = this.catalogs[type]
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
    try {
      const token = await this.getToken(type)
      const response = await firstValueFrom(
        this.httpService.get<T>(`${this.catalogs[type].baseUrl}${path}`, {
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

  // InfoAuto returns prices in thousands of pesos — convert to pesos for Triunfo
  async getVehicleValue(type: VehicleType, codia: number, year: number): Promise<string | null> {
    const currentYear = new Date().getFullYear()

    try {
      if (year < currentYear) {
        const { data } = await this.get<InfoAutoUsedPrice[] | { prices?: InfoAutoUsedPrice[] }>(
          type,
          `/models/${codia}/prices/`,
        )
        const prices = Array.isArray(data) ? data : (data?.prices ?? [])
        const match = prices.find(p => p.year === year)
        if (match?.price) return (match.price * 1000).toFixed(2)
      }

      const { data } = await this.get<{ price?: number; list_price?: number }>(type, `/models/${codia}/list_price`)
      const value = data?.price ?? data?.list_price
      return value ? (value * 1000).toFixed(2) : null
    } catch {
      this.logger.warn(`Could not resolve ${type} value for codia ${codia} (year ${year})`)
      return null
    }
  }
}
