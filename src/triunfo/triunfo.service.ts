import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'

// ─── Triunfo response types ──────────────────────────────

export interface TriunfoVehiculoDato {
  Dominio: string
  Marca: string
  Modelo: string
  SubModelo?: string
  Anio: number
  Chasis?: string
  Motor?: string
  Cobertura: string
  SumaAsegurada?: string
  Tipo?: string
  Uso?: string
  CeroKm?: number
}

export interface TriunfoCuotaDato {
  NumeroCuota: number
  FechaVtoCuota: string
  ImporteCuota: string
  Estado: string // "PAGADA" | "PENDIENTE" | "VENCIDA" etc.
  FechaCancelada?: string
}

export interface TriunfoNovedad {
  Articulo: number | string
  Certificado: string | number
  Suplemento?: number
  // Client data
  RazonSocial?: string // "APELLIDO NOMBRE" — primary name field
  Email?: string
  DocNumero: string | number
  DocTipo?: number
  Telefono?: string
  Domicilio?: string
  Localidad?: string
  Provincia?: string
  // Policy dates & state
  VigenciaDesde?: string
  VigenciaHasta?: string
  FechaEmision?: string
  EstadoPoliza?: string // "VIGENTE" | "REFACTURACION" | "VENCIDA" etc.
  // Financial
  MedioPagoDescripcion?: string
  DetallePremio?: { Premio?: string }
  // Nested data
  SDTVehiculoDatos?: TriunfoVehiculoDato[]
  SDTCuota?: TriunfoCuotaDato[]
  // Legacy fallback fields (older endpoint shapes)
  FechaVigDesde?: string
  FechaVigHasta?: string
  Estado?: string
  Asegurado?: string
  Patente?: string
  Premio?: string
  Cobertura?: string
}

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

  // NovedadesCartera uses Codigo/Usuario/Password auth — NOT JWT
  async getNovedadesCartera(fechaDesde: string, fechaHasta: string): Promise<TriunfoNovedad[]> {
    this.logger.log(`Consultando NovedadesCartera ${fechaDesde} → ${fechaHasta}`)

    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrlSip}/RESTNovedadesCartera`, {
        SDTWSNovedadesIn: {
          Articulo: '0',
          Certificado: '0',
          FechaDesde: fechaDesde,
          FechaHasta: fechaHasta,
          Productor: {
            Codigo: this.productor,
            Password: this.password,
            Usuario: this.usuario,
          },
        },
      }),
    )

    const out = response.data?.SDTWSNovedadesCarteraOut

    if (!out) {
      throw new Error(`Triunfo NovedadesCartera: respuesta inesperada — ${JSON.stringify(response.data)}`)
    }

    const resultado = out.Resultado
    const mensajes: Array<{ Description?: string; Id?: string; Type?: number }> = resultado?.Mensajes ?? []

    // Only throw on explicit error messages (Type=1) or Estado='N'
    const errorMsgs = mensajes.filter(m => m.Type === 1 || resultado?.Estado === 'N')
    if (errorMsgs.length > 0) {
      const msg = errorMsgs.map(m => m.Description ?? m.Id ?? '?').join('; ')
      throw new Error(`Triunfo NovedadesCartera: ${msg}`)
    }

    // Triunfo returns a single object instead of array when there is only one result
    const raw = out.Novedades ?? []
    return Array.isArray(raw) ? raw : [raw]
  }
}
