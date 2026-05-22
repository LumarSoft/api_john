import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'

@Injectable()
export class TriunfoService {
  private readonly logger = new Logger(TriunfoService.name)
  private cachedToken: string | null = null
  private tokenExpiresAt: number | null = null

  private readonly baseUrlAuth: string
  readonly baseUrlSip: string
  private readonly productor: string
  private readonly usuario: string
  private readonly password: string

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrlAuth = this.configService.getOrThrow<string>('TRIUNFO_BASE_URL_AUTH')
    this.baseUrlSip = this.configService.getOrThrow<string>('TRIUNFO_BASE_URL_SIP')
    this.productor = this.configService.getOrThrow<string>('TRIUNFO_PRODUCTOR')
    this.usuario = this.configService.getOrThrow<string>('TRIUNFO_USUARIO')
    this.password = this.configService.getOrThrow<string>('TRIUNFO_PASSWORD')
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    this.logger.log('Renovando token de Triunfo...')

    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrlAuth}/getTokenRest`, {
        SDTProductor: {
          Codigo: this.productor,
          Usuario: this.usuario,
          Password: this.password,
        },
      }),
    )

    const token: string = response.data?.Token

    if (!token) {
      throw new UnauthorizedException('No se pudo obtener token de Triunfo')
    }

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    this.tokenExpiresAt = (payload.exp - 300) * 1000
    this.cachedToken = token

    return token
  }

  async getAuth(): Promise<{ Productor: string; JWT: string }> {
    return {
      Productor: this.productor,
      JWT: await this.getToken(),
    }
  }
}
