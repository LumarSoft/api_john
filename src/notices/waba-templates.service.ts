import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'

/** A template the platform sends, as Meta names it. */
export interface TemplateRef {
  name: string
  lang: string
}

/** A WhatsApp Business account as the platform keeps it (its token encrypted). */
export interface WabaAccountRef {
  id: number
  wabaId: string
  accessToken: string
}

/** A template as Meta lists it in an account. */
export interface MetaTemplate {
  name: string
  language: string
  category: string | null
  status: string
  rejectedReason: string | null
  /** GREEN, YELLOW, RED or UNKNOWN (not sent enough to tell). */
  quality: string | null
}

/** A number of an account as Meta reports it. */
export interface MetaPhoneNumber {
  /** Meta's phone number id, PhoneNumber.phoneNumberId. */
  id: string
  quality: string | null
  /** TIER_50, TIER_250, TIER_1K…: how many people a day the business may start a chat with. */
  messagingLimit: string | null
}

/** What Meta answered when it could not be asked, for the owner. */
export class MetaGraphError extends Error {}

/** How long Meta's answer about a template counts: a send right after another does not ask again. */
const CACHE_MS = 5 * 60 * 1000

/** Every template of an account fits in a few pages; more is a loop that never ends. */
const MAX_PAGES = 10

interface GraphPage<T> {
  data?: T[]
  paging?: { next?: string }
  error?: { message?: string }
}

interface GraphTemplate {
  name?: string
  language?: string
  category?: string
  status?: string
  rejected_reason?: string
  quality_score?: { score?: string }
}

interface GraphPhoneNumber {
  id?: string
  quality_rating?: string
  messaging_limit_tier?: string
}

/**
 * The Meta templates of the WhatsApp Business accounts. A template only exists
 * in the account it was created in, and Meta refuses it from a number of any
 * other account (error 132001), so a notice must go out from a number whose
 * account has it.
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

  /** Every template of the account, in every language and state. Throws MetaGraphError when Meta does not answer. */
  async templatesOf(account: WabaAccountRef): Promise<MetaTemplate[]> {
    const rows = await this.list<GraphTemplate>(account, 'message_templates', {
      fields: 'name,language,category,status,rejected_reason,quality_score',
      limit: '100',
    })
    return rows.map(t => ({
      name: t.name ?? '',
      language: t.language ?? '',
      category: t.category ?? null,
      status: t.status ?? 'UNKNOWN',
      rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
      quality: t.quality_score?.score ?? null,
    }))
  }

  /** The account's numbers with their quality and daily limit. Throws MetaGraphError when Meta does not answer. */
  async numbersOf(account: WabaAccountRef): Promise<MetaPhoneNumber[]> {
    const rows = await this.list<GraphPhoneNumber>(account, 'phone_numbers', {
      fields: 'quality_rating,messaging_limit_tier',
    })
    return rows.flatMap(p =>
      p.id ? [{ id: p.id, quality: p.quality_rating ?? null, messagingLimit: p.messaging_limit_tier ?? null }] : [],
    )
  }

  /** True or false as Meta answered; null when it could not be asked. */
  private async isApproved(account: WabaAccountRef, template: TemplateRef, now: number): Promise<boolean | null> {
    const key = `${account.id}:${template.name}:${template.lang}`
    const cached = this.cache.get(key)
    if (cached && now - cached.at < CACHE_MS) return cached.approved
    try {
      const rows = await this.list<GraphTemplate>(account, 'message_templates', {
        name: template.name,
        fields: 'name,status,language',
      })
      const approved = rows.some(
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

  /** Every row of a list of the account, following Meta's pages. */
  private async list<T>(account: WabaAccountRef, edge: string, params: Record<string, string>): Promise<T[]> {
    const url = new URL(`${this.graphBase}/${account.wabaId}/${edge}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const token = this.token(account.accessToken)
    const rows: T[] = []
    let next: string | undefined = url.toString()
    for (let page = 0; next && page < MAX_PAGES; page++) {
      let data: GraphPage<T>
      let ok: boolean
      try {
        const res = await fetch(next, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        })
        ok = res.ok
        data = (await res.json()) as GraphPage<T>
      } catch (error) {
        throw new MetaGraphError(`No se pudo llegar a Meta: ${(error as Error).message}`)
      }
      if (!ok) throw new MetaGraphError(data.error?.message ?? 'Meta no respondió.')
      rows.push(...(data.data ?? []))
      next = data.paging?.next
    }
    return rows
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
