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

// Document returned by RESTConsultaInspV2 for a policy.
export interface TriunfoDocumento {
  Codigo: string
  Nombre: string
  Url: string
}

@Injectable()
export class TriunfoService {
  private readonly logger = new Logger(TriunfoService.name)
  private cachedToken: string | null = null
  private tokenExpiresAt: number | null = null

  // Short-lived in-memory cache of policy documents, keyed by certificado.
  private readonly documentosCache = new Map<string, { data: TriunfoDocumento[]; expiresAt: number }>()
  private static readonly DOCUMENTOS_TTL_MS = 10 * 60 * 1000 // 10 minutes

  // Fallback display names for known Triunfo document codes, used when the
  // provider returns an empty `Nombre`.
  private static readonly DOCUMENTO_NOMBRES: Record<string, string> = {
    '1000': 'Certificado de Cobertura',
    '1001': 'Tarjeta de Circulación',
    '1002': 'Cupón de Pago',
  }

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

  // NovedadesCartera uses Codigo/Usuario/Password auth — NOT JWT.
  // `codigo` selects which producer-code's cartera to pull. Confirmed against
  // Postman: the same master Usuario/Password works for every dependent código,
  // varying only `Codigo` in the request — so the cron iterates codes with the
  // org-level credential. Defaults to the org master code (TRIUNFO_PRODUCTOR).
  async getNovedadesCartera(
    fechaDesde: string,
    fechaHasta: string,
    codigo: string = this.productor,
  ): Promise<TriunfoNovedad[]> {
    this.logger.log(`Consultando NovedadesCartera código=${codigo} ${fechaDesde} → ${fechaHasta}`)

    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrlSip}/RESTNovedadesCartera`, {
        SDTWSNovedadesIn: {
          Articulo: '0',
          Certificado: '0',
          FechaDesde: fechaDesde,
          FechaHasta: fechaHasta,
          Productor: {
            Codigo: codigo,
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

  /**
   * Fetches the available documents of an emitted policy (certificado) on demand
   * via RESTConsultaInspV2. Requires a JWT, so the token is requested first.
   * Results are cached in memory for a few minutes per certificado.
   */
  async getDocumentos(certificado: string): Promise<TriunfoDocumento[]> {
    const cached = this.documentosCache.get(certificado)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data
    }

    this.logger.log(`Consultando documentos de la póliza ${certificado}`)

    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrlSip}/RESTConsultaInspV2`, {
        Autenticacion: await this.getAuth(),
        TipoOperacion: 'C', // C = Certificado (emitted policy)
        Operacion: certificado,
      }),
    )

    // Triunfo's real shape differs from the Postman sample: the wrapper is
    // `SDTConsultaInsp` (not `...Out`), the result is `SDTResultado` (not `Resultado`),
    // and documents may come as a `Documentos[]` array OR as a single `URL` string.
    // We parse both shapes defensively.
    const out = response.data?.SDTConsultaInsp ?? response.data?.SDTConsultaInspOut

    if (!out) {
      throw new Error(`Triunfo ConsultaInsp: respuesta inesperada — ${JSON.stringify(response.data)}`)
    }

    const resultado = out.SDTResultado ?? out.Resultado
    const estado: string | undefined = resultado?.Estado
    const mensajes: Array<{ Description?: string; Id?: string; Type?: number }> = resultado?.Mensajes ?? []

    // Estado 'S' = success. Anything else (e.g. 'N' — "no hay documentos" or
    // "no se encuentra esa operación") is a valid empty result for the portal,
    // not a hard error. Common in the sandbox where test certificados don't exist.
    if (estado !== 'S') {
      const msg = mensajes.map(m => m.Description ?? m.Id ?? '?').join('; ')
      this.logger.debug(`ConsultaInsp ${certificado}: sin documentos (${estado ?? '?'})${msg ? ` — ${msg}` : ''}`)
      this.documentosCache.set(certificado, { data: [], expiresAt: Date.now() + TriunfoService.DOCUMENTOS_TTL_MS })
      return []
    }

    const documentos = this.parseDocumentos(out)

    this.documentosCache.set(certificado, {
      data: documentos,
      expiresAt: Date.now() + TriunfoService.DOCUMENTOS_TTL_MS,
    })

    return documentos
  }

  // Normalizes the documents payload, which Triunfo returns either as a
  // `Documentos` array of { Codigo, Nombre, Url } or as a single `URL` string.
  private parseDocumentos(out: {
    Documentos?: TriunfoDocumento | TriunfoDocumento[]
    URL?: string
  }): TriunfoDocumento[] {
    if (out.Documentos) {
      const raw = Array.isArray(out.Documentos) ? out.Documentos : [out.Documentos]
      return raw
        .filter(doc => doc?.Url)
        .map(doc => ({
          ...doc,
          Nombre: doc.Nombre?.trim() || TriunfoService.DOCUMENTO_NOMBRES[doc.Codigo] || 'Documento de póliza',
        }))
    }
    if (out.URL) {
      return [{ Codigo: '', Nombre: 'Documento de póliza', Url: out.URL }]
    }
    return []
  }
}
