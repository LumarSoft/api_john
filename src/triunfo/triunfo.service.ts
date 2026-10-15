import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'

// ─── Triunfo response types ──────────────────────────────

export interface TriunfoVehiculoDato {
  Dominio: string
  Marca: string
  Modelo: string
  SubModelo?: string
  Anio: number
  // InfoAuto codes Triunfo used to price the vehicle.
  // codia = MarcaIA * 10000 + ModeloIA
  MarcaIA?: number
  ModeloIA?: number
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
  // CUIT/CUIL — used as the client identity when DocNumero is "0" (companies).
  CUIT?: string | number
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

/**
 * Splits an inclusive [desde, hasta] range (YYYY-MM-DD) into consecutive windows
 * of at most `days` days. Returns a single window when the range already fits.
 */
export function splitDateRange(desde: string, hasta: string, days: number): Array<[string, string]> {
  const end = new Date(`${hasta}T00:00:00Z`)
  const out: Array<[string, string]> = []
  let cursor = new Date(`${desde}T00:00:00Z`)

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    return [[desde, hasta]]
  }

  while (cursor <= end) {
    const to = new Date(cursor)
    to.setUTCDate(to.getUTCDate() + days - 1)
    out.push([cursor.toISOString().slice(0, 10), (to > end ? end : to).toISOString().slice(0, 10)])
    cursor = new Date(to)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

// What RESTDocumentosV2 needs to find a policy, as the cartera reports it.
export interface TriunfoPolicyRef {
  // Producer code the policy belongs to. Triunfo answers "Operación inexistente
  // o no asociada al productor" when asked with any other code.
  productor?: string
  empresa: string
  sucursal: string
  articulo: string
  certificado: string
}

// Document link returned by RESTDocumentosV2 for a policy.
export interface TriunfoDocumento {
  Codigo: string
  Nombre: string
  URL: string
}

@Injectable()
export class TriunfoService {
  private readonly logger = new Logger(TriunfoService.name)
  private cachedToken: string | null = null
  private tokenExpiresAt: number | null = null
  // Shared promise so N concurrent callers trigger ONE getTokenRest, not N.
  private tokenInFlight: Promise<string> | null = null

  // Renew this long before the real expiry, so a request never travels with a
  // token that dies mid-flight.
  private static readonly TOKEN_MARGIN_MS = 5 * 60 * 1000
  private static readonly TOKEN_TIMEOUT_MS = 30_000
  // NovedadesCartera is heavy (≈680 KB / 15 s for one week of the master code),
  // so it gets a much longer ceiling than the other calls — but never infinite:
  // without a timeout a hung call blocks the whole sequential sync forever.
  private static readonly NOVEDADES_TIMEOUT_MS = 180_000
  // Longest range asked to Triunfo in a single call. Wider ranges are split into
  // consecutive windows: a 30-day request never came back in testing.
  private static readonly NOVEDADES_CHUNK_DAYS = 7

  // Short-lived in-memory cache of policy documents, keyed by producer, artículo and certificado.
  private readonly documentosCache = new Map<string, { data: TriunfoDocumento[]; expiresAt: number }>()
  private static readonly DOCUMENTOS_TTL_MS = 10 * 60 * 1000 // 10 minutes
  private static readonly DOCUMENTOS_TIMEOUT_MS = 15_000
  // A document link redirects once to the PDF; more hops than this is not Triunfo.
  private static readonly DOCUMENTO_MAX_REDIRECTS = 5
  private static readonly DOCUMENTO_TIMEOUT_MS = 30_000
  // Cloudflare in front of TriunfoNet answers 403 to some non-browser clients.
  private static readonly BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

  private readonly baseUrlAuth: string
  readonly baseUrlSip: string
  private readonly productor: string
  private readonly usuario: string
  private readonly password: string

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrlAuth = this.configService.getOrThrow<string>('TRIUNFO_BASE_URL_AUTH')
    this.baseUrlSip = this.configService.getOrThrow<string>('TRIUNFO_BASE_URL_SIP')
    this.productor = this.configService.getOrThrow<string>('TRIUNFO_PRODUCTOR')
    this.usuario = this.configService.getOrThrow<string>('TRIUNFO_USUARIO')
    this.password = this.configService.getOrThrow<string>('TRIUNFO_PASSWORD')
  }

  /**
   * Returns a valid Triunfo JWT, minimising calls to `getTokenRest`.
   *
   * Triunfo issues a token valid ~24 h and returns the SAME one while it is
   * still alive ("Token aún no vencido"). They warned that hammering that
   * endpoint can get our IP blocked, so there are three layers of protection:
   *
   *   1. in-memory cache      — avoids a DB round-trip on every call
   *   2. IntegrationToken row — survives restarts/deploys and is shared by every
   *                             instance, so a redeploy no longer asks for a new one
   *   3. in-flight promise    — concurrent callers on a cold cache share ONE
   *                             request instead of firing N in parallel
   */
  async getToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    // Another caller is already fetching/loading — wait for that same promise.
    if (this.tokenInFlight) return this.tokenInFlight

    this.tokenInFlight = this.loadOrRenewToken().finally(() => {
      this.tokenInFlight = null
    })

    return this.tokenInFlight
  }

  /** Token key for this credential set, e.g. "triunfo:10484:JHONPELL". */
  private get tokenKey(): string {
    return `triunfo:${this.productor}:${this.usuario}`
  }

  private async loadOrRenewToken(): Promise<string> {
    // ── 1. Try the persisted token first (survives restarts and instances) ──
    try {
      const stored = await this.prisma.integrationToken.findUnique({
        where: { key: this.tokenKey },
      })
      if (stored && stored.expiresAt.getTime() - TriunfoService.TOKEN_MARGIN_MS > Date.now()) {
        this.cachedToken = stored.token
        this.tokenExpiresAt = stored.expiresAt.getTime() - TriunfoService.TOKEN_MARGIN_MS
        this.logger.debug(`Token de Triunfo reutilizado desde DB (vence ${stored.expiresAt.toISOString()})`)
        return stored.token
      }
    } catch (err) {
      // A DB hiccup must not block the integration — fall through to renewal.
      this.logger.warn(`No se pudo leer el token persistido: ${err instanceof Error ? err.message : err}`)
    }

    // ── 2. No usable token — ask Triunfo ────────────────────────────────────
    this.logger.log('Renovando token de Triunfo...')

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrlAuth}/getTokenRest`,
        {
          SDTProductor: {
            Codigo: this.productor,
            Usuario: this.usuario,
            Password: this.password,
          },
        },
        { timeout: TriunfoService.TOKEN_TIMEOUT_MS },
      ),
    )

    const token: string = response.data?.Token

    if (!token) {
      const resultado = response.data?.SDTResultado
      const detalle = (resultado?.Mensajes ?? []).map((m: { Description?: string }) => m.Description).join('; ')
      throw new UnauthorizedException(`No se pudo obtener token de Triunfo${detalle ? ` — ${detalle}` : ''}`)
    }

    const expiresAt = this.readExpiry(token)

    this.cachedToken = token
    this.tokenExpiresAt = expiresAt.getTime() - TriunfoService.TOKEN_MARGIN_MS

    // ── 3. Persist so the next restart reuses it instead of asking again ────
    try {
      await this.prisma.integrationToken.upsert({
        where: { key: this.tokenKey },
        create: { key: this.tokenKey, token, expiresAt },
        update: { token, expiresAt },
      })
    } catch (err) {
      this.logger.warn(`No se pudo persistir el token: ${err instanceof Error ? err.message : err}`)
    }

    return token
  }

  /**
   * Reads the `exp` claim of the JWT. Triunfo's token carries no `iat`, so we
   * only rely on `exp`. If the payload is unreadable we assume a short life
   * rather than caching something we cannot validate.
   */
  private readExpiry(token: string): Date {
    try {
      const raw = token.split('.')[1]
      const payload = JSON.parse(Buffer.from(raw, 'base64').toString()) as { exp?: number }
      if (payload.exp) return new Date(payload.exp * 1000)
    } catch {
      /* falls through to the conservative default */
    }
    this.logger.warn('No se pudo leer el exp del JWT de Triunfo — se asume 1 hora de vigencia')
    return new Date(Date.now() + 60 * 60 * 1000)
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
  /**
   * Pulls the cartera for a date range, splitting it into windows of at most
   * NOVEDADES_CHUNK_DAYS days.
   *
   * Measured in production for the master code: one week ≈ 225 novedades /
   * 680 KB / 15 s, while a 30-day request never completed. Long ranges (the
   * 3- and 6-month sync windows) are therefore impossible in a single call and
   * must be fetched window by window.
   */
  async getNovedadesCartera(
    fechaDesde: string,
    fechaHasta: string,
    codigo: string = this.productor,
  ): Promise<TriunfoNovedad[]> {
    const ventanas = splitDateRange(fechaDesde, fechaHasta, TriunfoService.NOVEDADES_CHUNK_DAYS)

    if (ventanas.length === 1) {
      return this.fetchNovedadesWindow(ventanas[0][0], ventanas[0][1], codigo)
    }

    this.logger.log(
      `NovedadesCartera código=${codigo} ${fechaDesde} → ${fechaHasta}: ${ventanas.length} ventanas de ${TriunfoService.NOVEDADES_CHUNK_DAYS} días`,
    )

    const todas: TriunfoNovedad[] = []
    for (const [desde, hasta] of ventanas) {
      // Sequential on purpose: Triunfo asked us not to hammer their services,
      // and these responses are heavy enough to matter.
      todas.push(...(await this.fetchNovedadesWindow(desde, hasta, codigo)))
    }
    return todas
  }

  /** One RESTNovedadesCartera call for a single (short) date window. */
  private async fetchNovedadesWindow(
    fechaDesde: string,
    fechaHasta: string,
    codigo: string,
  ): Promise<TriunfoNovedad[]> {
    this.logger.log(`Consultando NovedadesCartera código=${codigo} ${fechaDesde} → ${fechaHasta}`)

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrlSip}/RESTNovedadesCartera`,
        {
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
        },
        { timeout: TriunfoService.NOVEDADES_TIMEOUT_MS },
      ),
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
   * Lists the documents Triunfo has for a policy via RESTDocumentosV2: links to
   * the certificado, póliza, constancia de pago, tarjeta Mercosur and, for some
   * Plan de Pago policies, the cuponera. Requires a JWT. Results are cached in
   * memory for a few minutes; `fresh` skips the cache when the link itself is
   * about to be used, because how long a link lives is not documented.
   */
  async getDocumentos(ref: TriunfoPolicyRef, { fresh = false } = {}): Promise<TriunfoDocumento[]> {
    const productor = ref.productor ?? this.productor
    const key = `${productor}:${ref.articulo}:${ref.certificado}`
    const cached = this.documentosCache.get(key)
    if (!fresh && cached && Date.now() < cached.expiresAt) {
      return cached.data
    }

    this.logger.log(`Consultando documentos de la póliza ${ref.articulo}-${ref.certificado} (productor ${productor})`)

    const { JWT } = await this.getAuth()
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrlSip}/RESTDocumentosV2`,
        {
          SDTWSDocumentosIn: {
            Autenticacion: { JWT, Productor: productor },
            Empresa: ref.empresa,
            Sucursal: ref.sucursal,
            Articulo: ref.articulo,
            Certificado: ref.certificado,
          },
        },
        { timeout: TriunfoService.DOCUMENTOS_TIMEOUT_MS },
      ),
    )

    const out = response.data?.SDTWSDocumentosOut
    if (!out) {
      throw new BadGatewayException('Triunfo RESTDocumentosV2 returned an unexpected response')
    }

    // Estado 'N' (e.g. "Operación inexistente o no asociada al productor") is an
    // empty result for the caller, not a failure: the office still has the portal.
    if (out.Resultado?.Estado !== 'S') {
      const mensajes: Array<{ Description?: string; Id?: string }> = out.Resultado?.Mensajes ?? []
      this.logger.warn(
        `RESTDocumentosV2 ${ref.articulo}-${ref.certificado}: sin documentos — ${mensajes.map(m => m.Description ?? m.Id).join('; ') || out.Resultado?.Estado}`,
      )
      this.documentosCache.set(key, { data: [], expiresAt: Date.now() + TriunfoService.DOCUMENTOS_TTL_MS })
      return []
    }

    // Triunfo returns a single object instead of an array when there is one link,
    // and some links come broken (the Solicitud one starts with "nullcom.sip…").
    const links = ([] as TriunfoDocumento[]).concat((out.Links ?? []) as TriunfoDocumento | TriunfoDocumento[])
    const documentos = links.filter(link => this.isTriunfoUrl(link?.URL))

    this.documentosCache.set(key, { data: documentos, expiresAt: Date.now() + TriunfoService.DOCUMENTOS_TTL_MS })
    return documentos
  }

  /**
   * Downloads the PDF behind a RESTDocumentosV2 link. The link answers 302 to
   * the real file and opens the session with cookies in that same response;
   * following the redirect without them gets a 403, so the hops are followed
   * by hand carrying the cookies.
   */
  async downloadDocumento(url: string): Promise<Buffer> {
    if (!this.isTriunfoUrl(url)) throw new BadGatewayException('Triunfo returned a document link outside triunfonet')

    const cookies = new Map<string, string>()
    let next = url
    for (let hop = 0; hop <= TriunfoService.DOCUMENTO_MAX_REDIRECTS; hop++) {
      const response = await firstValueFrom(
        this.httpService.get<ArrayBuffer>(next, {
          responseType: 'arraybuffer',
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: TriunfoService.DOCUMENTO_TIMEOUT_MS,
          headers: {
            'User-Agent': TriunfoService.BROWSER_USER_AGENT,
            Accept: 'application/pdf,*/*',
            ...(cookies.size > 0 ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
          },
        }),
      )

      const setCookie = response.headers['set-cookie'] as string[] | undefined
      for (const header of setCookie ?? []) {
        const [pair] = header.split(';')
        const separator = pair.indexOf('=')
        if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1))
      }

      const location = response.headers.location as string | undefined
      if (response.status >= 300 && response.status < 400 && location) {
        next = new URL(location, next).toString()
        if (!this.isTriunfoUrl(next)) throw new BadGatewayException('Triunfo redirected a document outside triunfonet')
        continue
      }

      const body = Buffer.from(response.data)
      if (response.status !== 200 || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new BadGatewayException(`Triunfo document download failed (HTTP ${response.status})`)
      }
      return body
    }
    throw new BadGatewayException('Triunfo document download redirected too many times')
  }

  // Document links are only ever followed on Triunfo's own site.
  private isTriunfoUrl(url: string | undefined): url is string {
    if (!url) return false
    try {
      const { protocol, hostname } = new URL(url)
      return protocol === 'https:' && (hostname === 'triunfonet.com.ar' || hostname.endsWith('.triunfonet.com.ar'))
    } catch {
      return false
    }
  }
}
