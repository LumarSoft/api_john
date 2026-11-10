import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { SancorService } from './sancor.service'
import type {
  SancorAccidentAgeRange,
  SancorLocation,
  SancorModule,
  SancorModuleProduct,
  SancorProductPlan,
  SancorProductQuotation,
} from './sancor.types'

/** What the bot can quote with Sancor: the lead product types it sells. */
export const SANCOR_BOT_PRODUCT_TYPES = ['bolso', 'hogar', 'bici', 'personas'] as const
export type SancorBotProductType = (typeof SANCOR_BOT_PRODUCT_TYPES)[number]

const MODULE_PRODUCT: Record<SancorBotProductType, SancorModuleProduct> = {
  bolso: 'bag',
  hogar: 'homeProtected',
  bici: 'bicycle',
  personas: 'accidentespersonales/24',
}

/**
 * Personal-accident capitals offered when SANCOR_AP_MODULES is not set: 8, 10
 * and 20 million (modules of GET /modules/accidentespersonales/24, 9/11/2026).
 * Each one is a call, so the list stays short.
 */
const DEFAULT_AP_MODULES = [47, 60, 72]

/** A WhatsApp list holds 10 rows. */
const MAX_PLANS = 10

/** A plan as the bot shows it: the same shape as the office's fixed-price plans. */
export interface SancorBotPlan {
  // The Sancor module (offeringCode), not a ProductPlan id.
  id: number
  productType: SancorBotProductType
  name: string
  monthlyPrice: number
  description: string | null
  coverageItems: Array<{ label: string; amount: number }>
  isActive: true
  sortOrder: number
}

export interface SancorBotQuote {
  insurer: 'Sancor'
  zipCode: number
  quotationId: number | null
  plans: SancorBotPlan[]
}

export interface SancorBotQuoteInput {
  productType: SancorBotProductType
  zipCode: number
  cityName?: string
  documentNumber?: number
  birthDate?: string
}

/**
 * Sancor prices for the bot's lead products. Opt-in per organization: the
 * Sancor credentials in .env are one producer's (JPMG), so only the producers
 * listed in SANCOR_BOT_PRODUCER_IDS quote with them, and none by default while
 * the integration runs on Sancor's preproduction, whose prices are not real.
 */
@Injectable()
export class SancorBotQuotesService {
  private readonly logger = new Logger(SancorBotQuotesService.name)
  private readonly producerIds: Set<number>
  private readonly apModules: number[]

  constructor(
    private readonly prisma: PrismaService,
    private readonly sancor: SancorService,
    configService: ConfigService,
  ) {
    this.producerIds = new Set(parseIds(configService.get<string>('SANCOR_BOT_PRODUCER_IDS')))
    const apModules = parseIds(configService.get<string>('SANCOR_AP_MODULES'))
    this.apModules = apModules.length ? apModules : DEFAULT_AP_MODULES
  }

  /** The product types this conversation's bot quotes with Sancor (none when it is off). */
  async productsFor(conversationId: number): Promise<{ productTypes: SancorBotProductType[] }> {
    const enabled = this.sancor.isConfigured && this.producerIds.has(await this.producerOf(conversationId))
    return { productTypes: enabled ? [...SANCOR_BOT_PRODUCT_TYPES] : [] }
  }

  async quote(conversationId: number, input: SancorBotQuoteInput): Promise<SancorBotQuote> {
    const { productTypes } = await this.productsFor(conversationId)
    if (!productTypes.includes(input.productType)) {
      throw new NotFoundException('Sancor no cotiza este producto para este número')
    }

    // An unknown postal code is the customer's to fix: a 400 the bot re-asks.
    const location = await this.sancor.resolveLocation(input.zipCode, input.cityName)
    const modules = await this.sancor.getModules(MODULE_PRODUCT[input.productType])

    try {
      const quotation = await this.quoteProduct(input, location, modules)
      const plans = quotation.plans
        .filter(p => p.monthlyPremium > 0)
        .sort((a, b) => a.monthlyPremium - b.monthlyPremium)
        .slice(0, MAX_PLANS)
        .map((p, i) => this.toBotPlan(input.productType, p, modules, i))
      return { insurer: 'Sancor', zipCode: input.zipCode, quotationId: quotation.quotationId ?? null, plans }
    } catch (err) {
      // Sancor's own failures are already a 502; anything else is ours to report as one.
      if (err instanceof HttpException) throw err
      this.logger.warn(`Sancor no cotizó ${input.productType}: ${(err as Error).message}`)
      throw new BadGatewayException('Sancor no pudo cotizar en este momento')
    }
  }

  private async quoteProduct(
    input: SancorBotQuoteInput,
    location: SancorLocation,
    modules: SancorModule[],
  ): Promise<SancorProductQuotation> {
    const ids = modules.map(m => m.id)
    switch (input.productType) {
      case 'bolso':
        return this.sancor.quoteBag(location, ids)
      case 'hogar':
        // Sancor answers only the modules the producer sells (70 to 73 for JPMG).
        return this.sancor.quoteHomeProtected(location, ids)
      case 'bici':
        return this.sancor.quoteBicycle(location)
      case 'personas':
        return this.quoteAccidents(input, location, ids)
    }
  }

  // One call per capital: AP24 prices a single module at a time.
  private async quoteAccidents(
    input: SancorBotQuoteInput,
    location: SancorLocation,
    available: number[],
  ): Promise<SancorProductQuotation> {
    if (!input.documentNumber) throw new BadRequestException('Sancor pide el DNI para cotizar accidentes personales')
    const wanted = this.apModules.filter(id => available.includes(id))
    const modules = wanted.length ? wanted : available.slice(0, DEFAULT_AP_MODULES.length)
    const ageRange = accidentAgeRange(input.birthDate)
    const quotations = await Promise.all(
      modules.map(module =>
        this.sancor.quotePersonalAccident({
          location,
          module,
          document: { number: input.documentNumber!, type: 'D' },
          ageRange,
        }),
      ),
    )
    return { quotationId: quotations[0]?.quotationId, plans: quotations.flatMap(q => q.plans) }
  }

  private toBotPlan(
    productType: SancorBotProductType,
    plan: SancorProductPlan,
    modules: SancorModule[],
    index: number,
  ): SancorBotPlan {
    const name = modules.find(m => m.id === plan.module)?.description || `Plan ${plan.module}`
    // Services go as a note: without a capital ("Asistencia en viaje a las
    // Personas", hogar) or with a token 1 ("Llamando al Doctor", AP).
    const isService = (capital: number) => capital <= 1
    const included = plan.coverages.filter(c => isService(c.capital)).map(c => c.description)
    return {
      id: plan.module,
      productType,
      name: planName(productType, name),
      monthlyPrice: Math.round(plan.monthlyPremium),
      description: included.length ? `Incluye ${included.join(', ').toLowerCase()}` : null,
      coverageItems: plan.coverages
        .filter(c => !isService(c.capital))
        .map(c => ({ label: c.description, amount: Math.round(c.capital) })),
      isActive: true,
      sortOrder: index,
    }
  }

  private async producerOf(conversationId: number): Promise<number> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { producerId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return conversation.producerId
  }
}

function parseIds(value: string | undefined): number[] {
  return (value ?? '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(n => Number.isInteger(n) && n > 0)
}

/**
 * "Plan 1 - AGOSTO 2026" reads as a date to a customer: the month is Sancor's
 * plan revision. Bag and bicycle plans are named by their capital ("Plan 2000"
 * → "Plan $2.000"), personal-accident modules too ("Capital $8.000.000").
 */
function planName(productType: SancorBotProductType, name: string): string {
  const clean = name.replace(/\s*-\s*[a-záéíóú]+\s+\d{4}\s*$/i, '').trim()
  if (productType === 'personas') return clean.replace(/^Módulo/i, 'Capital')
  const capital = Number(/^Plan ([\d.]+)$/i.exec(clean)?.[1]?.replace(/\./g, ''))
  return capital >= 1000 ? `Plan $${capital.toLocaleString('es-AR')}` : clean
}

/** Sancor's age range from a DD/MM/AAAA birth date; 16 to 70 when it cannot be read. */
export function accidentAgeRange(birthDate: string | undefined, now = new Date()): SancorAccidentAgeRange {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(birthDate?.trim() ?? '')
  if (!match) return '16-70'
  const [, day, month, year] = match.map(Number)
  let age = now.getFullYear() - year
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1
  if (age > 75) return '76+'
  if (age > 70) return '71-75'
  return '16-70'
}
