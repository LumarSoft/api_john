import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { CampaignDefinition, exampleValues, placeholdersIn, toTemplateText } from './campaign-catalog'

export type CampaignTemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_SUBMITTED' | 'ERROR'

/** Meta's review of a campaign's template in one WhatsApp account, as SalesCampaign.templates keeps it. */
export interface StoredTemplate {
  name: string
  id: string | null
  status: CampaignTemplateStatus
  reason: string | null
  checkedAt: string
}

/** By WabaAccount id. */
export type StoredTemplates = Record<string, StoredTemplate>

/** An account of the organization that can send: connected, with an active number. */
export interface SendingAccount {
  id: number
  wabaId: string
  wabaName: string | null
  accessToken: string
  numbers: string[]
}

/** What the panel shows of each account. */
export interface CampaignTemplateView {
  wabaName: string | null
  numbers: string[]
  status: CampaignTemplateStatus
  reason: string | null
}

const LANGUAGE = 'es_AR'

/** Why Meta rejected a template, said for the office. */
const REJECTION_REASONS: Record<string, string> = {
  INVALID_FORMAT: 'Meta dice que el formato no es válido (revisá los datos variables y los signos).',
  ABUSIVE_CONTENT: 'Meta lo considera contenido abusivo.',
  INCORRECT_CATEGORY: 'Meta dice que no corresponde a la categoría marketing.',
  TAG_CONTENT_MISMATCH: 'Meta dice que el texto no corresponde a la categoría marketing.',
  SCAM: 'Meta lo considera posible estafa.',
  PROMOTIONAL: 'Meta lo considera promocional de una forma que no acepta.',
}

interface GraphTemplate {
  id?: string
  name?: string
  status?: string
  rejected_reason?: string
}

interface GraphError {
  error?: { message?: string; error_subcode?: number; error_user_msg?: string }
}

/**
 * The Meta templates of the sales campaigns. A template lives in one WhatsApp
 * Business account, so each campaign text goes to review in every account of
 * the organization; a new text is a new template (campana_<kind>_v<n>), which
 * keeps the review of every version apart.
 */
@Injectable()
export class CampaignTemplatesService {
  private readonly logger = new Logger(CampaignTemplatesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get graphBase(): string {
    return `https://graph.facebook.com/${this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'}`
  }

  /** The organization's accounts with an active, connected number. */
  async accounts(producerId: number): Promise<SendingAccount[]> {
    const rows = await this.prisma.wabaAccount.findMany({
      where: {
        producerId,
        disconnectedAt: null,
        phoneNumbers: { some: { deletedAt: null, isActive: true } },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        wabaId: true,
        wabaName: true,
        accessToken: true,
        phoneNumbers: {
          where: { deletedAt: null, isActive: true },
          select: { number: true, branchName: true },
          orderBy: { id: 'asc' },
        },
      },
    })
    return rows.map(r => ({
      id: r.id,
      wabaId: r.wabaId,
      wabaName: r.wabaName,
      accessToken: r.accessToken,
      // As the panel shows them: with the branch when it has one ("+54 9 341 275-7294 · 27 de Febrero").
      numbers: r.phoneNumbers.map(p => (p.branchName ? `${p.number} · ${p.branchName}` : p.number)),
    }))
  }

  /** Sends a campaign text to review in every account; what Meta answered, by account. */
  async submit(
    producerId: number,
    definition: CampaignDefinition,
    body: string,
    version: number,
    only?: SendingAccount[],
  ): Promise<StoredTemplates> {
    const name = `${definition.templateSlug}_v${version}`
    const examples = exampleValues(definition)
    const text = toTemplateText(body)
    const exampleRow = placeholdersIn(body).map(key => examples[key] ?? key)
    const result: StoredTemplates = {}
    for (const account of only ?? (await this.accounts(producerId))) {
      result[String(account.id)] = await this.create(account, name, text, exampleRow)
    }
    return result
  }

  /** Asks Meta again for the templates still in review (or that failed to reach it). */
  async refresh(producerId: number, stored: StoredTemplates): Promise<StoredTemplates> {
    const accounts = new Map((await this.accounts(producerId)).map(a => [String(a.id), a]))
    const result: StoredTemplates = { ...stored }
    for (const [accountId, template] of Object.entries(stored)) {
      const account = accounts.get(accountId)
      if (!account || template.status === 'APPROVED' || template.status === 'REJECTED') continue
      result[accountId] = await this.lookup(account, template.name, template)
    }
    return result
  }

  /** True when something in `stored` is still waiting for Meta. */
  hasPending(stored: StoredTemplates): boolean {
    return Object.values(stored).some(t => t.status === 'PENDING' || t.status === 'ERROR')
  }

  /** Each sending account with its template's review; an account added after the last text has none. */
  view(accounts: SendingAccount[], stored: StoredTemplates): CampaignTemplateView[] {
    return accounts.map(account => {
      const template = stored[String(account.id)]
      return {
        wabaName: account.wabaName,
        numbers: account.numbers,
        status: template?.status ?? 'NOT_SUBMITTED',
        reason: template?.reason ?? null,
      }
    })
  }

  /** The accounts whose template Meta approved: the only ones that can send the campaign. */
  approvedAccounts(stored: StoredTemplates): Map<number, string> {
    return new Map(
      Object.entries(stored)
        .filter(([, t]) => t.status === 'APPROVED')
        .map(([id, t]) => [Number(id), t.name]),
    )
  }

  // ─── Meta ──────────────────────────────────────────────

  private async create(
    account: SendingAccount,
    name: string,
    text: string,
    example: string[],
  ): Promise<StoredTemplate> {
    const checkedAt = new Date().toISOString()
    try {
      const res = await fetch(`${this.graphBase}/${account.wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token(account)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          language: LANGUAGE,
          category: 'MARKETING',
          components: [{ type: 'BODY', text, ...(example.length ? { example: { body_text: [example] } } : {}) }],
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json()) as GraphTemplate & GraphError
      if (!res.ok) {
        // A template with that name already exists (a retry): read what Meta has.
        if (data.error?.error_subcode === 2388023 || /already exists/i.test(data.error?.message ?? '')) {
          return this.lookup(account, name, { name, id: null, status: 'PENDING', reason: null, checkedAt })
        }
        this.logger.warn(`Meta rechazó la plantilla ${name} de la cuenta ${account.id}: ${data.error?.message}`)
        return {
          name,
          id: null,
          status: 'ERROR',
          reason: data.error?.error_user_msg || data.error?.message || 'Meta no aceptó la plantilla.',
          checkedAt,
        }
      }
      return { name, id: data.id ?? null, ...statusOf(data), checkedAt }
    } catch (error) {
      this.logger.warn(`No se pudo mandar la plantilla ${name} de la cuenta ${account.id}: ${(error as Error).message}`)
      return {
        name,
        id: null,
        status: 'ERROR',
        reason: 'No se pudo llegar a Meta. Probá de nuevo más tarde.',
        checkedAt,
      }
    }
  }

  private async lookup(account: SendingAccount, name: string, current: StoredTemplate): Promise<StoredTemplate> {
    const checkedAt = new Date().toISOString()
    try {
      const url = new URL(`${this.graphBase}/${account.wabaId}/message_templates`)
      url.searchParams.set('name', name)
      url.searchParams.set('fields', 'id,name,status,rejected_reason,language')
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token(account)}` },
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json()) as { data?: Array<GraphTemplate & { language?: string }> } & GraphError
      if (!res.ok) return { ...current, checkedAt }
      const template = data.data?.find(t => t.name === name && (!t.language || t.language === LANGUAGE))
      if (!template) {
        // Never reached Meta: an error to retry with a new text, or a template someone deleted.
        return current.status === 'ERROR'
          ? { ...current, checkedAt }
          : {
              ...current,
              status: 'ERROR',
              reason: 'Meta no tiene esta plantilla. Volvé a guardar el mensaje.',
              checkedAt,
            }
      }
      return { name, id: template.id ?? current.id, ...statusOf(template), checkedAt }
    } catch {
      return { ...current, checkedAt }
    }
  }

  private token(account: SendingAccount): string {
    return decryptSecret(
      account.accessToken,
      resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY'),
    )
  }
}

/** Meta's status, folded into the four the panel shows. */
function statusOf(template: GraphTemplate): { status: CampaignTemplateStatus; reason: string | null } {
  switch (template.status) {
    case 'APPROVED':
      return { status: 'APPROVED', reason: null }
    case 'REJECTED':
      return {
        status: 'REJECTED',
        reason:
          REJECTION_REASONS[template.rejected_reason ?? ''] ??
          (template.rejected_reason && template.rejected_reason !== 'NONE'
            ? `Meta la rechazó (${template.rejected_reason}).`
            : 'Meta la rechazó.'),
      }
    case 'PAUSED':
    case 'DISABLED':
      return {
        status: 'REJECTED',
        reason:
          'Meta la pausó por la respuesta de los clientes (muchos la bloquearon o la marcaron). Probá con otro texto.',
      }
    default:
      // PENDING, IN_APPEAL and whatever Meta adds: still waiting.
      return { status: 'PENDING', reason: null }
  }
}
