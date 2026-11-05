import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'

/** A template the platform sends, as Meta names it. */
export interface TemplateRef {
  name: string
  lang: string
}

/** How long Meta's answer about a template counts: a send right after another does not ask again. */
const CACHE_MS = 5 * 60 * 1000

/**
 * Which WhatsApp Business accounts have a template approved. A template only
 * exists in the account it was created in, and Meta refuses it from a number
 * of any other account (error 132001), so a notice must go out from a number
 * whose account has it.
 */
@Injectable()
export class WabaTemplatesService {
  private readonly logger = new Logger(WabaTemplatesService.name)
  private readonly cache = new Map<string, { approved: boolean; at: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The accounts among `accountIds` where Meta said the template is not
   * approved (missing, in review, rejected or paused). An account Meta did not
   * answer for is left out: the send itself then says what went wrong.
   */
  async notApprovedIn(accountIds: number[], template: TemplateRef, now = Date.now()): Promise<Set<number>> {
    const missing = new Set<number>()
    if (!accountIds.length) return missing
    const accounts = await this.prisma.wabaAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, wabaId: true, accessToken: true },
    })
    for (const account of accounts) {
      const approved = await this.isApproved(account, template, now)
      if (approved === false) missing.add(account.id)
    }
    return missing
  }

  /** True or false as Meta answered; null when it could not be asked. */
  private async isApproved(
    account: { id: number; wabaId: string; accessToken: string },
    template: TemplateRef,
    now: number,
  ): Promise<boolean | null> {
    const key = `${account.id}:${template.name}:${template.lang}`
    const cached = this.cache.get(key)
    if (cached && now - cached.at < CACHE_MS) return cached.approved
    try {
      const url = new URL(`${this.graphBase}/${account.wabaId}/message_templates`)
      url.searchParams.set('name', template.name)
      url.searchParams.set('fields', 'name,status,language')
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token(account.accessToken)}` },
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json()) as {
        data?: Array<{ name?: string; status?: string; language?: string }>
        error?: { message?: string }
      }
      if (!res.ok) {
        this.logger.warn(
          `Meta no respondió por la plantilla ${template.name} de la cuenta ${account.id}: ${data.error?.message}`,
        )
        return null
      }
      const approved = (data.data ?? []).some(
        t => t.name === template.name && t.language === template.lang && t.status === 'APPROVED',
      )
      this.cache.set(key, { approved, at: now })
      return approved
    } catch (error) {
      this.logger.warn(
        `No se pudo consultar la plantilla ${template.name} de la cuenta ${account.id}: ${(error as Error).message}`,
      )
      return null
    }
  }

  private get graphBase(): string {
    return `https://graph.facebook.com/${this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'}`
  }

  private token(encrypted: string): string {
    return decryptSecret(
      encrypted,
      resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY'),
    )
  }
}
