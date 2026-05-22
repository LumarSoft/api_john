import { BadGatewayException, Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { AxiosError } from 'axios'
import { firstValueFrom } from 'rxjs'
import { InfoAutoQueryDto } from './dto/infoauto-query.dto'

@Injectable()
export class InfoAutoService {
  private readonly logger = new Logger(InfoAutoService.name)

  private readonly baseUrl: string
  private readonly authUrl: string
  private readonly email: string
  private readonly password: string

  private cachedToken: string | null = null
  private tokenExpiresAt: number | null = null

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('INFOAUTO_BASE_URL')
    this.authUrl = this.configService.getOrThrow<string>('INFOAUTO_AUTH_URL')
    this.email = this.configService.getOrThrow<string>('INFOAUTO_EMAIL')
    this.password = this.configService.getOrThrow<string>('INFOAUTO_PASSWORD')
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    this.logger.log('Refreshing InfoAuto token...')

    const response = await firstValueFrom(
      this.httpService.post<{ access_token: string }>(
        `${this.authUrl}/login`,
        {},
        { auth: { username: this.email, password: this.password } },
      ),
    )

    const token = response.data?.access_token
    if (!token) throw new BadGatewayException('InfoAuto API error')

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    this.tokenExpiresAt = (payload.exp - 300) * 1000
    this.cachedToken = token

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

  private async get<T>(path: string, params?: Record<string, unknown>) {
    try {
      const token = await this.getToken()
      const response = await firstValueFrom(
        this.httpService.get<T>(`${this.baseUrl}${path}`, {
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
        throw new BadGatewayException('InfoAuto API error')
      }
      throw error
    }
  }

  getBrands(query: InfoAutoQueryDto) {
    return this.get('/brands/', { ...query })
  }

  getGroups(brandId: number, query: InfoAutoQueryDto) {
    return this.get(`/brands/${brandId}/groups/`, { ...query })
  }

  getModels(brandId: number, groupId: number, query: InfoAutoQueryDto) {
    return this.get(`/brands/${brandId}/groups/${groupId}/models/`, { ...query })
  }
}
