import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { Cron, CronExpression } from '@nestjs/schedule'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'

/** What Meta says about a WhatsApp account and the business portfolio that owns it. */
export interface WabaPortfolio {
  wabaName: string | null
  businessId: string | null
  businessName: string | null
  /** Meta's business_verification_status: verified, not_verified, pending… */
  businessVerification: string | null
}

interface GraphWaba {
  name?: string
  business_verification_status?: string
  owner_business_info?: { id?: string; name?: string }
}

/**
 * Reads from Graph which business portfolio owns each connected WhatsApp account, so the panel can show it with the
 * number. Read-only: one GET per account, at onboarding, daily and at boot for accounts never read. Failures only log.
 */
@Injectable()
export class WhatsappPortfolioService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhatsappPortfolioService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private get enabled(): boolean {
    // Same switch as the connection check: both call Meta for every connected account.
    return this.config.get<string>('WHATSAPP_CONNECTION_CHECK_ENABLED') !== 'false'
  }

  private get graphBase(): string {
    const version = this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'
    return `https://graph.facebook.com/${version}`
  }

  /** Accounts connected before this existed get read once, in the background. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return
    void this.refreshAll({ portfolioCheckedAt: null }).catch(err =>
      this.logger.warn(`Portfolio backfill failed: ${err instanceof Error ? err.message : err}`),
    )
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async refreshDaily(): Promise<number> {
    if (!this.enabled) return 0
    return this.refreshAll({})
  }

  /** Reads and stores the portfolio of one account with a token at hand (onboarding). */
  async refreshWith(wabaAccountId: number, wabaId: string, accessToken: string): Promise<WabaPortfolio | null> {
    const portfolio = await this.fetch(wabaId, accessToken)
    if (!portfolio) return null
    await this.prisma.wabaAccount.update({
      where: { id: wabaAccountId },
      data: { ...portfolio, portfolioCheckedAt: new Date() },
    })
    return portfolio
  }

  private async refreshAll(where: { portfolioCheckedAt?: null }): Promise<number> {
    const accounts = await this.prisma.wabaAccount.findMany({
      where: { ...where, disconnectedAt: null, phoneNumbers: { some: { deletedAt: null } } },
      select: { id: true, wabaId: true, accessToken: true },
    })
    let read = 0
    for (const account of accounts) {
      const token = decryptSecret(account.accessToken, this.encryptionKey())
      if (await this.refreshWith(account.id, account.wabaId, token)) read++
    }
    if (accounts.length) this.logger.log(`Portfolios de Meta leídos: ${read} de ${accounts.length}`)
    return read
  }

  private async fetch(wabaId: string, accessToken: string): Promise<WabaPortfolio | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<GraphWaba>(`${this.graphBase}/${wabaId}`, {
          params: { fields: 'name,owner_business_info,business_verification_status' },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10_000,
        }),
      )
      return {
        wabaName: data.name ?? null,
        businessId: data.owner_business_info?.id ?? null,
        businessName: data.owner_business_info?.name ?? null,
        businessVerification: data.business_verification_status ?? null,
      }
    } catch (err) {
      const graph = (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
      this.logger.warn(`No se pudo leer el portfolio de la WABA ${wabaId}: ${graph?.message ?? (err as Error).message}`)
      return null
    }
  }

  private encryptionKey() {
    return resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY')
  }
}
