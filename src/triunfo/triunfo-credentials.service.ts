import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { TriunfoService } from './triunfo.service'
import { TriunfoErrorsService } from './triunfo-errors.service'
import { SaveTriunfoCredentialDto } from './dto/save-triunfo-credential.dto'

/** What the owner sees of an organization's Triunfo access — never the password. */
export interface TriunfoCredentialStatus {
  configured: boolean
  productor: string | null
  username: string | null
  verifiedAt: Date | null
  /** No credentials of its own, but the default organization runs on the TRIUNFO_* settings. */
  usesDefaultSettings: boolean
  /** Since when Triunfo refuses the credentials in use (own or TRIUNFO_*); null while it accepts them. */
  failingSince: Date | null
  /** What Triunfo answered when it refused them. */
  failureMessage: string | null
  /** Provisional: without credentials of its own, its quotes go out with the default organization's. */
  quoteFallback: boolean
}

/**
 * The owner gives each organization its own Triunfo web-service access. They
 * are only saved once Triunfo accepts them, so an organization never ends up
 * with credentials that fail on every quote.
 */
@Injectable()
export class TriunfoCredentialsService {
  private readonly logger = new Logger(TriunfoCredentialsService.name)
  private readonly savedListeners: Array<(producerId: number) => void> = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly config: ConfigService,
    private readonly errors: TriunfoErrorsService,
  ) {}

  /**
   * Tells `listener` each time an organization gets credentials Triunfo accepts.
   * The cartera sync uses it to start a new organization's first import; it
   * lives in a module that already depends on this one.
   */
  onSaved(listener: (producerId: number) => void): void {
    this.savedListeners.push(listener)
  }

  async status(producerId: number): Promise<TriunfoCredentialStatus> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: {
        slug: true,
        triunfoQuoteFallback: true,
        triunfoCredential: { select: { productor: true, username: true, verifiedAt: true, deletedAt: true } },
      },
    })
    if (!producer) throw new NotFoundException(`Organization ${producerId} not found`)

    const own = producer.triunfoCredential?.deletedAt === null ? producer.triunfoCredential : null
    const health = await this.errors.authState(producerId)
    return {
      configured: own !== null,
      productor: own?.productor ?? null,
      username: own?.username ?? null,
      verifiedAt: own?.verifiedAt ?? null,
      usesDefaultSettings: own === null && this.triunfo.hasEnvCredentialsFor(producer.slug),
      failingSince: health.failingSince,
      failureMessage: health.failureMessage,
      quoteFallback: producer.triunfoQuoteFallback,
    }
  }

  /**
   * Lets an organization without credentials quote with the default
   * organization's Triunfo account, or stops it. Refused for an organization
   * that already quotes with an account of its own.
   */
  async setQuoteFallback(producerId: number, enabled: boolean): Promise<TriunfoCredentialStatus> {
    const status = await this.status(producerId)
    if (enabled && (status.configured || status.usesDefaultSettings)) {
      throw new BadRequestException('La organización ya cotiza con su propia cuenta de Triunfo')
    }
    await this.prisma.producer.update({ where: { id: producerId }, data: { triunfoQuoteFallback: enabled } })
    return { ...status, quoteFallback: enabled }
  }

  async save(producerId: number, dto: SaveTriunfoCredentialDto): Promise<TriunfoCredentialStatus> {
    await this.status(producerId)

    const credentials = { productor: dto.productor.trim(), usuario: dto.username.trim(), password: dto.password }
    try {
      await this.triunfo.verifyCredentials(credentials)
    } catch (err) {
      if (err instanceof UnauthorizedException) throw new BadRequestException(err.message)
      throw new BadGatewayException('No se pudo contactar a Triunfo para validar las credenciales. Probá de nuevo.')
    }

    const key = resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY')
    const data = {
      productor: credentials.productor,
      username: credentials.usuario,
      password: encryptSecret(credentials.password, key),
      verifiedAt: new Date(),
      deletedAt: null,
    }
    await this.prisma.triunfoCredential.upsert({
      where: { producerId },
      create: { producerId, ...data },
      update: data,
    })
    // Its own account from now on: the provisional one ends here, and does not
    // come back by itself if these credentials are removed later.
    await this.prisma.producer.update({ where: { id: producerId }, data: { triunfoQuoteFallback: false } })
    this.triunfo.forgetCredentials(producerId)
    // Triunfo just accepted them: an outage of the old ones is over.
    await this.errors.credentialsAccepted(producerId)
    for (const listener of this.savedListeners) {
      // A listener's trouble is never the owner's: the credentials are saved.
      try {
        listener(producerId)
      } catch (err) {
        this.logger.error(`Credentials listener failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    return this.status(producerId)
  }

  /** Removes the organization's own access (soft delete); the default org falls back to TRIUNFO_*. */
  async remove(producerId: number): Promise<TriunfoCredentialStatus> {
    await this.status(producerId)
    await this.prisma.triunfoCredential.updateMany({
      where: { producerId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    this.triunfo.forgetCredentials(producerId)
    return this.status(producerId)
  }
}
