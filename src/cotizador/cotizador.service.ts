import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { parseCoverageOverrides, type CoverageOverrides } from '../common/coverage-overrides'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { isAxiosError } from 'axios'
import { firstValueFrom } from 'rxjs'
import { Prisma } from 'generated/prisma/client'
import { NovedadesService } from '../novedades/novedades.service'
import { NovedadType } from '../novedades/dto/list-novedades.dto'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { InfoAutoService } from '../infoauto/infoauto.service'
import { VehicleType } from '../infoauto/infoauto.types'
import { QuoteVehicleDto } from './dto/quote-vehicle.dto'
import { CoverageRequestDto } from './dto/coverage-request.dto'
import { isVisiblePaymentMethod, paymentMethodLabel } from '../common/payment-methods'
import { CoverageSettingsService } from '../coverage-settings/coverage-settings.service'
import type { QuoteCoverage, QuoteAutoResult, NormalizedQuote, CoverageRequestResult } from './cotizador.types'

// Triunfo answers a quote in 1–2 s. Without a cap a hung call stayed open
// forever while the bot gave up at 20 s; 15 s returns a clear error first.
const TRIUNFO_QUOTE_TIMEOUT_MS = 15_000

/**
 * Triunfo's quote takes the GNC equipment as an accessory whose code we do not
 * have yet, and a wrong code changes every price. Liability is the same with
 * or without it (a real 465 policy with GNC matches the quote without any
 * accessory to the peso), so the price is right for RC and the office adds the
 * equipment when it issues the policy.
 */
const GNC_NOT_PRICED_MESSAGE = 'El precio no incluye el equipo de GNC: un asesor lo suma al emitir la póliza.'

const VALUATION_MISSING_MESSAGE =
  'La compañía no pudo valuar el vehículo en este momento, por eso solo se cotizó Responsabilidad Civil. Las coberturas con robo, incendio y daños las cotiza un asesor.'
export type { QuoteCoverage, QuotePaymentOption, QuoteAutoResult } from './cotizador.types'

// ─── Triunfo raw response types ──────────────────────────

interface TriunfoCotizacionRaw {
  FormaPagoCod?: string
  FormaPagoNom?: string
  Premio?: string
  ValorCuota?: string
  Cuotas?: number
  Bonificacion?: string
}

interface TriunfoMensajeRaw {
  Description?: string
  Id?: string
  Type?: number
}

interface TriunfoCoberturaRaw {
  Cobertura?: string
  Cotizaciones?: TriunfoCotizacionRaw[] | TriunfoCotizacionRaw
  Resultado?: { Estado?: string; Mensajes?: TriunfoMensajeRaw[] }
}

interface TriunfoCotizadorRaw {
  SDTSrvCotizacionOut?: {
    Coberturas?: TriunfoCoberturaRaw[] | TriunfoCoberturaRaw
    DatosAdicionales?: Array<{ Codigo?: string; Nombre?: string; Valor?: string }>
    Presupuesto?: { Numero?: string; Vigencia?: string }
    Resultado?: { Estado?: string; Mensajes?: TriunfoMensajeRaw[] }
  }
}

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

// Triunfo product code per vehicle line — RESTCotizadorAutV2 quotes both from the same endpoint
const TRIUNFO_ARTICULO: Record<VehicleType, number> = {
  [VehicleType.AUTO]: 458,
  [VehicleType.MOTO]: 481,
}

@Injectable()
export class CotizadorService {
  private readonly logger = new Logger(CotizadorService.name)

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly infoAuto: InfoAutoService,
    private readonly coverageSettings: CoverageSettingsService,
    private readonly configService: ConfigService,
    private readonly novedades: NovedadesService,
  ) {}

  async quoteVehicle(
    vehicleType: VehicleType,
    dto: QuoteVehicleDto,
    producerId: number | null,
    userId: number | null,
    // How the number the quote is for offers the organization's coverages (null = as the organization).
    coverageOverrides: CoverageOverrides | null = null,
    // Meta id of the WhatsApp number the quote came through (null for the web and the panel).
    originPhoneNumberId: string | null = null,
  ): Promise<QuoteAutoResult> {
    const brandNumber = Number(dto.brand)
    const codiaNumber = Number(dto.model)
    if (
      !Number.isSafeInteger(brandNumber) ||
      brandNumber <= 0 ||
      !Number.isSafeInteger(codiaNumber) ||
      codiaNumber <= 10_000 ||
      Math.floor(codiaNumber / 10_000) !== brandNumber
    ) {
      throw new BadRequestException('Invalid vehicle brand/CODIA combination')
    }
    if (!this.infoAuto.isAvailable(vehicleType)) {
      throw new ServiceUnavailableException(`El catálogo de InfoAuto para ${vehicleType} no está disponible`)
    }
    // A 0km is this year's model (or last year's still unsold), never older.
    if (dto.zeroKm && dto.manufactureYear < new Date().getFullYear() - 1) {
      throw new BadRequestException(`Un 0 km no puede ser del año ${dto.manufactureYear}. Revisá el año o si es usado.`)
    }
    await this.infoAuto.validateVehicleYear(vehicleType, brandNumber, codiaNumber, dto.manufactureYear)
    // Quoted with the organization's own Triunfo account (null = the default org's).
    const auth = await this.triunfo.getAuth(producerId)

    // Vehicle value comes from InfoAuto when valuation is contracted. It is not
    // today (403), so this resolves to null and Valor "0" tells Triunfo to look
    // up the market value itself — it returns it in DatosAdicionales.
    const vehicleValue = await this.infoAuto.getVehicleValue(vehicleType, Number(dto.model), dto.manufactureYear)
    const origin = await this.infoAuto.getVehicleOrigin(vehicleType, Number(dto.model))
    const triunfoModel = this.toTriunfoModelCode(dto.brand, dto.model)
    this.logger.debug(
      `Quoting ${vehicleType} codia ${dto.model} → Triunfo Marca ${dto.brand} Modelo ${triunfoModel} (${dto.manufactureYear}) — origen ${origin}, InfoAuto value: ${vehicleValue ?? 'N/A'}`,
    )

    let result: TriunfoCotizadorRaw
    try {
      const response = await firstValueFrom(
        this.httpService.post<TriunfoCotizadorRaw>(
          `${this.triunfo.baseUrlSip}/RESTCotizadorAutV2`,
          {
            SDTSrvCotizacionIn: {
              Automotor: {
                Accesorios: [],
                Adicionales: [],
                AnioFabricacion: dto.manufactureYear,
                Bonificacion: '0',
                Catalogo: 'IA',
                CeroKM: dto.zeroKm ? 1 : 0,
                Cobertura: dto.coverage ?? '',
                Marca: dto.brand,
                Modelo: triunfoModel,
                Origen: origin,
                Uso: 1,
                Valor: vehicleValue ?? '0',
              },
              General: {
                Articulo: TRIUNFO_ARTICULO[vehicleType],
                CantidadCuotas: 1,
                GenerarPresupuesto: true,
                ZonaRiesgoCP: dto.postalCode,
              },
              Autenticacion: auth,
            },
          },
          { timeout: TRIUNFO_QUOTE_TIMEOUT_MS },
        ),
      )
      result = response.data
    } catch (error) {
      this.logger.error(`Triunfo RESTCotizadorAutV2 request failed: ${(error as Error).message}`)
      if (isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new GatewayTimeoutException('El cotizador de Triunfo no respondió a tiempo')
      }
      throw new BadGatewayException('Triunfo cotizador error')
    }

    const out = result?.SDTSrvCotizacionOut
    if (!out) {
      this.logger.error(`Triunfo RESTCotizadorAutV2 unexpected response: ${JSON.stringify(result)}`)
      throw new BadGatewayException('Triunfo cotizador error')
    }

    const quoteNumber = Number.parseInt(out.Presupuesto?.Numero ?? '', 10)
    const resolvedProducerId = await this.resolveProducerId(producerId)

    if (quoteNumber) {
      await this.prisma.quote.upsert({
        where: { quoteNumber },
        create: {
          quoteNumber,
          vehicleType,
          brandCode: dto.brand,
          modelCode: dto.model,
          manufactureYear: dto.manufactureYear,
          postalCode: dto.postalCode,
          result: result as Prisma.InputJsonValue,
          producerId: resolvedProducerId,
          // Anonymous/web quotes are credited to the org master code by default.
          producerCodeId: await this.resolveDefaultProducerCodeId(resolvedProducerId),
          userId,
          phoneNumberId: originPhoneNumberId,
        },
        update: { result: result as Prisma.InputJsonValue },
      })
    }

    const quote = this.normalizeResult(result)

    // Register any coverage code we had not seen before, so the admin screen
    // lists real Triunfo codes. Never blocks or breaks a quote.
    void this.coverageSettings
      .registerDiscovered(
        resolvedProducerId,
        quote.coverages.map(c => c.code),
      )
      .catch(err => this.logger.warn(`No se pudieron registrar las coberturas: ${(err as Error).message}`))

    // Motorcycles are offered as Triunfo's own cotizador does — RC (A),
    // RC + incendio (B4) and RC + incendio + robo (B1) — plus B ("todo total"),
    // which Triunfo prices but hides on its web and the office sells (22/10).
    const requiredCodes = vehicleType === VehicleType.MOTO ? ['A', 'B4', 'B1', 'B'] : []
    const offered =
      vehicleType === VehicleType.MOTO ? quote.coverages.filter(c => requiredCodes.includes(c.code)) : quote.coverages
    const coverages = await this.coverageSettings.apply(
      resolvedProducerId,
      offered,
      dto.manufactureYear,
      requiredCodes,
      vehicleType,
      coverageOverrides,
    )
    const valuationMissing = this.isValuationMissing(result, quote)
    if (valuationMissing) {
      this.logger.warn(
        `Triunfo no valuó ${vehicleType} codia ${dto.model} (${dto.manufactureYear}): solo cotizó Responsabilidad Civil`,
      )
    }
    const missing = valuationMissing ? [] : requiredCodes.filter(code => !coverages.some(c => c.code === code))
    return {
      ...quote,
      coverages,
      valuationMissing,
      messages: [
        ...quote.messages,
        ...(valuationMissing ? [VALUATION_MISSING_MESSAGE] : []),
        ...(dto.hasGnc && vehicleType === VehicleType.AUTO && coverages.length > 0 ? [GNC_NOT_PRICED_MESSAGE] : []),
        ...missing.map(
          code => `No se obtuvo precio para la cobertura ${code}. Consultá con un asesor para revisar esa opción.`,
        ),
      ],
    }
  }

  /**
   * Triunfo values the vehicle itself (we send Valor "0"). When that lookup
   * fails it still answers, but with ValorVehiculo 0 and every coverage except
   * Responsabilidad Civil marked "Cobertura no válida" — which reads as "this
   * car can't be insured against theft" when it only means "not valued now".
   * A year Triunfo does not insure is rejected outright instead, so this shape
   * is never a real answer. Seen on 32 of 80 production quotes by 13/10/2026.
   */
  private isValuationMissing(raw: TriunfoCotizadorRaw, quote: NormalizedQuote): boolean {
    const value = Number.parseFloat(quote.vehicleValue ?? '')
    if (value > 0) return false
    const rejected = toArray(raw.SDTSrvCotizacionOut?.Coberturas).filter(c => c.Resultado?.Estado === 'N')
    return rejected.length > 0 && quote.coverages.every(c => c.code === 'A')
  }

  /**
   * A quote the WhatsApp bot asks for on a number: it belongs to the number's
   * organization and goes out with its Triunfo account, instead of falling to
   * the default organization like an anonymous web quote.
   */
  async quoteVehicleForNumber(
    phoneNumberId: string,
    vehicleType: VehicleType,
    dto: QuoteVehicleDto,
  ): Promise<QuoteAutoResult> {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId, isActive: true, deletedAt: null },
      select: { producerId: true, coverageSettings: true },
    })
    if (!phone) throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    // The number's own view of the coverages (which to offer, recommend and first).
    const overrides = parseCoverageOverrides(phone.coverageSettings)
    return this.quoteVehicle(
      vehicleType,
      dto,
      phone.producerId,
      null,
      Object.keys(overrides).length ? overrides : null,
      phoneNumberId,
    )
  }

  async requestCoverage(quoteNumber: number, dto: CoverageRequestDto): Promise<CoverageRequestResult> {
    const cotizacion = await this.prisma.quote.findFirst({
      where: { quoteNumber, deletedAt: null },
      select: { id: true, result: true, producerId: true, producerCodeId: true, phoneNumberId: true },
    })
    if (!cotizacion) throw new NotFoundException(`Quote ${quoteNumber} not found`)

    // The chosen coverage must be one that was actually quoted for this presupuesto
    const quote = this.normalizeResult((cotizacion.result ?? {}) as unknown as TriunfoCotizadorRaw)
    if (!quote.coverages.some(c => c.code === dto.coverage)) {
      throw new BadRequestException(`Coverage ${dto.coverage} is not available for quote ${quoteNumber}`)
    }

    const startDate = this.parseDateOnly(dto.startDate)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    if (startDate < today) throw new BadRequestException('startDate cannot be in the past')

    // Coverage cannot start after the quote expires
    if (quote.validUntil && startDate > this.parseDateOnly(quote.validUntil)) {
      throw new BadRequestException('startDate cannot be after the quote expiration date')
    }

    const data = {
      selectedCoverage: dto.coverage,
      coverageStartDate: startDate,
      applicantType: dto.personType,
      applicantFirstName: dto.firstName,
      applicantLastName: dto.lastName ?? null,
      applicantEmail: dto.email,
      applicantPhone: dto.phone,
      applicantBirthDate: dto.birthDate ? this.parseDateOnly(dto.birthDate) : null,
      applicantDocType: dto.docType,
      applicantDocNumber: dto.docNumber,
      applicantAddress: dto.address,
      // Only the preferred method: card data is never taken here, an agent
      // finalizes the payment when issuing the policy.
      paymentMethod: dto.paymentMethod,
    }

    // 1:1 with the quote — re-submitting the same quote overwrites the previous lead
    const solicitud = await this.prisma.quoteRequest.upsert({
      where: { quoteId: cotizacion.id },
      create: { quoteId: cotizacion.id, ...data },
      update: { ...data, deletedAt: null, status: 'NEW' },
    })

    // Re-submissions refresh the same matter rather than adding another task.
    await this.novedades.recordQuote(cotizacion.producerId, {
      type: NovedadType.SOLICITUD,
      refId: solicitud.id,
      name: `${dto.firstName} ${dto.lastName ?? ''}`.trim(),
      producerCodeId: cotizacion.producerCodeId,
      phoneNumberId: cotizacion.phoneNumberId,
      summary: `Eligió cobertura ${dto.coverage}. Contacto: ${dto.phone}. Pendiente de gestionar contratación.`,
    })

    // Fire-and-forget: greet the client on WhatsApp so they get follow-up on
    // their quote. Disabled until QUOTE_FOLLOWUP_TEMPLATE is configured (the
    // approved Meta template name). Never blocks or breaks the coverage request.
    void this.notifyClientWhatsApp(cotizacion.producerId, dto.phone, dto.firstName).catch(err =>
      this.logger.warn(`No se pudo notificar al cliente por WhatsApp: ${(err as Error).message}`),
    )

    return { quoteNumber: String(quoteNumber), coverage: dto.coverage, startDate: dto.startDate }
  }

  /**
   * Sends the approved "seguimiento de cotización" template to the client via the
   * bot. No-op until QUOTE_FOLLOWUP_TEMPLATE (the approved Meta template name) is
   * set, so it can be enabled the moment Meta approves the template. Uses an
   * active phone number of the organization as the sender.
   */
  private async notifyClientWhatsApp(producerId: number, phone: string, name: string): Promise<void> {
    const template = this.configService.get<string>('QUOTE_FOLLOWUP_TEMPLATE')
    if (!template) return // disabled until the template is approved & configured

    const lang = this.configService.get<string>('QUOTE_FOLLOWUP_TEMPLATE_LANG') ?? 'es_AR'
    const botUrl = this.configService.get<string>('BOT_URL')
    const secret = this.configService.get<string>('BOT_SECRET')
    if (!botUrl || !secret || !phone) return

    const phoneNumber = await this.prisma.phoneNumber.findFirst({
      where: { producerId, isActive: true, deletedAt: null },
      select: { phoneNumberId: true },
    })
    if (!phoneNumber) return

    await firstValueFrom(
      this.httpService.post(
        `${botUrl}/internal/send-template`,
        { to: phone, phoneNumberId: phoneNumber.phoneNumberId, template, lang, params: [name] },
        { headers: { 'x-bot-secret': secret } },
      ),
    )
  }

  // Dates arrive as YYYY-MM-DD; anchor them at UTC midnight to avoid timezone drift
  private parseDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  }

  // InfoAuto codia = brandId * 10000 + model number; Triunfo expects the model number alone
  // (e.g. codia 120567 for brand 12 → Modelo "567")
  private toTriunfoModelCode(brand: string, codia: string): string {
    const brandNum = Number(brand)
    const codiaNum = Number(codia)
    if (!Number.isInteger(brandNum) || !Number.isInteger(codiaNum)) return codia

    const model = codiaNum - brandNum * 10000
    return model > 0 && model < 10000 ? String(model) : codia
  }

  // Anonymous quotes from the public web belong to the default producer (John)
  private async resolveProducerId(producerId: number | null): Promise<number> {
    if (producerId) return producerId

    const slug = this.configService.get<string>('DEFAULT_PRODUCER_SLUG', 'john')
    const producer = await this.prisma.producer.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    })

    if (!producer) throw new InternalServerErrorException(`Default producer "${slug}" not found`)
    return producer.id
  }

  // Default code attribution for a quote: the organization's master code (or
  // null if none is configured yet). Admin-initiated quotes could later pass a
  // specific code via the userId's grants.
  private async resolveDefaultProducerCodeId(producerId: number): Promise<number | null> {
    const master = await this.prisma.producerCode.findFirst({
      where: { producerId, isMaster: true, deletedAt: null },
      select: { id: true },
    })
    return master?.id ?? null
  }

  private normalizeResult(result: TriunfoCotizadorRaw): NormalizedQuote {
    const out = result.SDTSrvCotizacionOut

    const coverages: QuoteCoverage[] = toArray(out?.Coberturas)
      .filter(c => c.Resultado?.Estado === 'S' && toArray(c.Cotizaciones).length > 0)
      .map(c => ({
        code: c.Cobertura ?? '',
        paymentOptions: toArray(c.Cotizaciones)
          .filter(q => isVisiblePaymentMethod(q.FormaPagoCod))
          .map(q => ({
            code: q.FormaPagoCod ?? '',
            name: paymentMethodLabel(q.FormaPagoCod, q.FormaPagoNom ?? ''),
            premium: Number.parseFloat(q.Premio ?? '0') || 0,
            installmentValue: Number.parseFloat(q.ValorCuota ?? '0') || 0,
            installments: q.Cuotas ?? 1,
          })),
      }))
      // A coverage whose only quote was a hidden method has no price to show
      .filter(c => c.paymentOptions.length > 0)
      .sort((a, b) => this.minPremium(a) - this.minPremium(b))

    const vehicleValue = out?.DatosAdicionales?.find(d => d.Nombre === 'ValorVehiculo')?.Valor?.trim() ?? null

    // Type 1 = error (e.g. "Código de modelo no válido") — surface them so the front can explain empty results
    const messages = (out?.Resultado?.Mensajes ?? [])
      .filter(m => m.Type === 1 && m.Description)
      .map(m => m.Description as string)

    return {
      quoteNumber: out?.Presupuesto?.Numero ?? null,
      validUntil: out?.Presupuesto?.Vigencia ?? null,
      vehicleValue,
      coverages,
      messages,
    }
  }

  private minPremium(coverage: QuoteCoverage): number {
    const premiums = coverage.paymentOptions.map(p => p.premium).filter(p => p > 0)
    return premiums.length > 0 ? Math.min(...premiums) : Number.MAX_SAFE_INTEGER
  }
}
