import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { InfoAutoService } from '../infoauto/infoauto.service'
import { VehicleType } from '../infoauto/infoauto.types'
import { QuoteVehicleDto } from './dto/quote-vehicle.dto'
import { CoverageRequestDto } from './dto/coverage-request.dto'
import { encryptCardNumber } from './card-crypto'
import type { QuoteCoverage, QuoteAutoResult, CoverageRequestResult } from './cotizador.types'
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
    private readonly configService: ConfigService,
  ) {}

  async quoteVehicle(
    vehicleType: VehicleType,
    dto: QuoteVehicleDto,
    producerId: number | null,
    userId: number | null,
  ): Promise<QuoteAutoResult> {
    const auth = await this.triunfo.getAuth()

    // Postman flow: vehicle value comes from InfoAuto (0km list price or used price by year).
    // If unavailable, Valor "0" tells Triunfo to look up the market value automatically.
    const vehicleValue = await this.infoAuto.getVehicleValue(vehicleType, Number(dto.model), dto.manufactureYear)
    const triunfoModel = this.toTriunfoModelCode(dto.brand, dto.model)
    this.logger.debug(
      `Quoting ${vehicleType} codia ${dto.model} → Triunfo Marca ${dto.brand} Modelo ${triunfoModel} (${dto.manufactureYear}) — InfoAuto value: ${vehicleValue ?? 'N/A'}`,
    )

    let result: TriunfoCotizadorRaw
    try {
      const response = await firstValueFrom(
        this.httpService.post<TriunfoCotizadorRaw>(`${this.triunfo.baseUrlSip}/RESTCotizadorAutV2`, {
          SDTSrvCotizacionIn: {
            Automotor: {
              Accesorios: [],
              Adicionales: [],
              AnioFabricacion: dto.manufactureYear,
              Bonificacion: '0',
              Catalogo: 'IA',
              CeroKM: 0,
              Cobertura: dto.coverage ?? '',
              Marca: dto.brand,
              Modelo: triunfoModel,
              Origen: 'N',
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
        }),
      )
      result = response.data
    } catch (error) {
      this.logger.error(`Triunfo RESTCotizadorAutV2 request failed: ${(error as Error).message}`)
      throw new BadGatewayException('Triunfo cotizador error')
    }

    const out = result?.SDTSrvCotizacionOut
    if (!out) {
      this.logger.error(`Triunfo RESTCotizadorAutV2 unexpected response: ${JSON.stringify(result)}`)
      throw new BadGatewayException('Triunfo cotizador error')
    }

    const quoteNumber = Number.parseInt(out.Presupuesto?.Numero ?? '', 10)

    if (quoteNumber) {
      await this.prisma.cotizacion.upsert({
        where: { quoteNumber },
        create: {
          quoteNumber,
          vehicleType,
          brandCode: dto.brand,
          modelCode: dto.model,
          manufactureYear: dto.manufactureYear,
          postalCode: dto.postalCode,
          result: result as Prisma.InputJsonValue,
          producerId: await this.resolveProducerId(producerId),
          userId,
        },
        update: { result: result as Prisma.InputJsonValue },
      })
    }

    return this.normalizeResult(result)
  }

  async requestCoverage(quoteNumber: number, dto: CoverageRequestDto): Promise<CoverageRequestResult> {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { quoteNumber, deletedAt: null },
      select: { id: true, result: true },
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

    const paysWithCard = dto.paymentMethod !== 'OTHER'
    if (paysWithCard && dto.cardExpiry && dto.cardExpiry < this.currentYearMonth()) {
      throw new BadRequestException('cardExpiry cannot be in the past')
    }

    // The PAN never touches the database in plaintext — resolve the key before writing anything
    const encryptedCardNumber =
      paysWithCard && dto.cardNumber ? encryptCardNumber(dto.cardNumber, this.cardEncryptionKey()) : null

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
      paymentMethod: dto.paymentMethod,
      cardCompany: paysWithCard ? (dto.cardCompany ?? null) : null,
      cardNumber: encryptedCardNumber,
      cardExpiry: paysWithCard ? (dto.cardExpiry ?? null) : null,
      cardHolder: paysWithCard ? (dto.cardHolder ?? null) : null,
    }

    // 1:1 with the quote — re-submitting the same quote overwrites the previous lead
    await this.prisma.solicitud.upsert({
      where: { cotizacionId: cotizacion.id },
      create: { cotizacionId: cotizacion.id, ...data },
      update: { ...data, deletedAt: null },
    })

    return { quoteNumber: String(quoteNumber), coverage: dto.coverage, startDate: dto.startDate }
  }

  // Dates arrive as YYYY-MM-DD; anchor them at UTC midnight to avoid timezone drift
  private parseDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  }

  private currentYearMonth(): string {
    const now = new Date()
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  }

  // 64 hex chars = 32-byte AES-256 key. Fail loudly rather than ever persisting a plaintext PAN.
  private cardEncryptionKey(): Buffer {
    const hex = this.configService.get<string>('CARD_ENCRYPTION_KEY', '')
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new InternalServerErrorException('CARD_ENCRYPTION_KEY is not configured')
    }
    return Buffer.from(hex, 'hex')
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

  private normalizeResult(result: TriunfoCotizadorRaw): QuoteAutoResult {
    const out = result.SDTSrvCotizacionOut

    const coverages: QuoteCoverage[] = toArray(out?.Coberturas)
      .filter(c => c.Resultado?.Estado === 'S' && toArray(c.Cotizaciones).length > 0)
      .map(c => ({
        code: c.Cobertura ?? '',
        paymentOptions: toArray(c.Cotizaciones).map(q => ({
          code: q.FormaPagoCod ?? '',
          name: q.FormaPagoNom ?? '',
          premium: Number.parseFloat(q.Premio ?? '0') || 0,
          installmentValue: Number.parseFloat(q.ValorCuota ?? '0') || 0,
          installments: q.Cuotas ?? 1,
        })),
      }))
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
