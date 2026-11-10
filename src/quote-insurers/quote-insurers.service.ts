import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SancorService } from '../sancor/sancor.service'
import { TriunfoErrorsService } from '../triunfo/triunfo-errors.service'
import { TriunfoNotConfiguredException, TriunfoService } from '../triunfo/triunfo.service'
import type { UpdateQuoteInsurersDto } from './dto/update-quote-insurers.dto'

export type QuoteInsurer = 'triunfo' | 'sancor'

/** One insurer as "Configuración" shows it. */
export interface QuoteInsurerState {
  enabled: boolean
  /** What the bot quotes with it. */
  products: string[]
  /** What the organization lacks to use it (credentials, codes, a refused password); empty = nothing. */
  problems: string[]
}

export type QuoteInsurersStatus = Record<QuoteInsurer, QuoteInsurerState>

const PRODUCTS: Record<QuoteInsurer, string[]> = {
  triunfo: ['Auto', 'Moto'],
  sancor: ['Bolso protegido', 'Hogar', 'Bici', 'Accidentes personales'],
}

const TRIUNFO_NOT_CONFIGURED =
  'Esta organización no tiene credenciales de Triunfo (las carga Lumarsoft en Organizaciones → Integración con Triunfo).'

/**
 * Which insurers each organization's bot quotes with. Turning one on asks the
 * insurer for a token with the organization's credentials first: a switch that
 * is on always worked at least once, and one that cannot work never turns on.
 */
@Injectable()
export class QuoteInsurersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly triunfoErrors: TriunfoErrorsService,
    private readonly sancor: SancorService,
  ) {}

  async status(producerId: number): Promise<QuoteInsurersStatus> {
    const producer = await this.producer(producerId)
    return {
      triunfo: {
        enabled: producer.triunfoQuotesEnabled,
        products: PRODUCTS.triunfo,
        problems: await this.triunfoProblems(producerId),
      },
      sancor: {
        enabled: producer.sancorQuotesEnabled,
        products: PRODUCTS.sancor,
        problems: this.sancor.missingFor(producer.slug),
      },
    }
  }

  async update(producerId: number, dto: UpdateQuoteInsurersDto): Promise<QuoteInsurersStatus> {
    const producer = await this.producer(producerId)
    if (dto.triunfo && !producer.triunfoQuotesEnabled) await this.verifyTriunfo(producerId)
    if (dto.sancor && !producer.sancorQuotesEnabled) await this.verifySancor(producer.slug)

    await this.prisma.producer.update({
      where: { id: producerId },
      data: {
        ...(dto.triunfo !== undefined ? { triunfoQuotesEnabled: dto.triunfo } : {}),
        ...(dto.sancor !== undefined ? { sancorQuotesEnabled: dto.sancor } : {}),
      },
    })
    return this.status(producerId)
  }

  // Without a network call: the outage Triunfo's calls already recorded.
  private async triunfoProblems(producerId: number): Promise<string[]> {
    try {
      await this.triunfo.credentialsFor(producerId)
    } catch (err) {
      if (err instanceof TriunfoNotConfiguredException) return [TRIUNFO_NOT_CONFIGURED]
      throw err
    }
    const { failingSince, failureMessage } = await this.triunfoErrors.authState(producerId)
    if (!failingSince) return []
    return [`Triunfo rechaza las credenciales de esta organización${failureMessage ? `: ${failureMessage}` : '.'}`]
  }

  private async verifyTriunfo(producerId: number): Promise<void> {
    let credentials: Awaited<ReturnType<TriunfoService['credentialsFor']>>
    try {
      credentials = await this.triunfo.credentialsFor(producerId)
    } catch (err) {
      if (err instanceof TriunfoNotConfiguredException) throw new BadRequestException(TRIUNFO_NOT_CONFIGURED)
      throw err
    }
    try {
      await this.triunfo.verifyCredentials(credentials)
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw new BadRequestException(
          `Triunfo no dio el token con las credenciales de esta organización: ${err.message}`,
        )
      }
      throw new BadGatewayException('No se pudo contactar a Triunfo para verificar las credenciales. Probá de nuevo.')
    }
    // Triunfo just accepted them: an outage of these credentials is over.
    await this.triunfoErrors.credentialsAccepted(producerId)
  }

  private async verifySancor(producerSlug: string): Promise<void> {
    const missing = this.sancor.missingFor(producerSlug)
    if (missing.length) throw new BadRequestException(missing.join(' '))
    try {
      await this.sancor.verifyToken()
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw new BadRequestException(`Sancor no dio el token con el usuario de esta organización: ${err.message}`)
      }
      throw new BadGatewayException('No se pudo contactar a Sancor para verificar el usuario. Probá de nuevo.')
    }
  }

  private async producer(producerId: number) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { slug: true, triunfoQuotesEnabled: true, sancorQuotesEnabled: true },
    })
    if (!producer) throw new NotFoundException(`Organization ${producerId} not found`)
    return producer
  }
}
