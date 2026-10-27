import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { TriunfoService } from './triunfo.service'
import { SaveTriunfoCredentialDto } from './dto/save-triunfo-credential.dto'

/** What the owner sees of an organization's Triunfo access — never the password. */
export interface TriunfoCredentialStatus {
  configured: boolean
  productor: string | null
  username: string | null
  verifiedAt: Date | null
  /** No credentials of its own, but the default organization runs on the TRIUNFO_* settings. */
  usesDefaultSettings: boolean
}

/**
 * The owner gives each organization its own Triunfo web-service access. They
 * are only saved once Triunfo accepts them, so an organization never ends up
 * with credentials that fail on every quote.
 */
@Injectable()
export class TriunfoCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly config: ConfigService,
  ) {}

  async status(producerId: number): Promise<TriunfoCredentialStatus> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: {
        slug: true,
        triunfoCredential: { select: { productor: true, username: true, verifiedAt: true, deletedAt: true } },
      },
    })
    if (!producer) throw new NotFoundException(`Organization ${producerId} not found`)

    const own = producer.triunfoCredential?.deletedAt === null ? producer.triunfoCredential : null
    return {
      configured: own !== null,
      productor: own?.productor ?? null,
      username: own?.username ?? null,
      verifiedAt: own?.verifiedAt ?? null,
      usesDefaultSettings: own === null && this.triunfo.hasEnvCredentialsFor(producer.slug),
    }
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
    this.triunfo.forgetCredentials(producerId)
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
