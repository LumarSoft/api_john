import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { campaignOfDbKind } from '../sales-campaigns/campaign-catalog'
import { accountRows, ExpectedTemplate, TemplateRowView } from './templates-overview'
import { MetaGraphError, MetaPhoneNumber, MetaTemplate, WabaTemplatesService } from './waba-templates.service'

/** A number of the account, with what Meta says about it. */
export interface TemplatesNumberView {
  number: string
  branchName: string | null
  /** GREEN, YELLOW, RED, UNKNOWN; null when Meta did not say. */
  quality: string | null
  /** TIER_250…: how many people a day the number may start a chat with; null when Meta did not say. */
  messagingLimit: string | null
}

export interface TemplatesAccountView {
  id: number
  wabaName: string | null
  numbers: TemplatesNumberView[]
  /** Meta could not be asked for the account's templates (an expired token…). */
  error: string | null
  templates: TemplateRowView[]
}

export interface TemplatesOverview {
  checkedAt: string
  organizations: Array<{ id: number; name: string; accounts: TemplatesAccountView[] }>
}

/** The notices the platform sends with a template, as configured on the server (the same for every organization). */
const NOTICE_TEMPLATES = [
  { env: 'PAYMENT_REJECTION_TEMPLATE', use: 'Avisos de rechazos de pago' },
  { env: 'POLICY_EXPIRY_TEMPLATE', use: 'Avisos de pólizas vencidas' },
  { env: 'QUOTE_FOLLOWUP_TEMPLATE', use: 'Seguimiento de cotizaciones de la web' },
] as const

/**
 * The owner's view of the Meta templates: every WhatsApp account that can
 * send, with its numbers' quality and daily limit, the templates the platform
 * needs there (a notice, a campaign's current text) and everything else Meta
 * has in it.
 */
@Injectable()
export class TemplatesOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly templates: WabaTemplatesService,
  ) {}

  async overview(): Promise<TemplatesOverview> {
    const accounts = await this.prisma.wabaAccount.findMany({
      where: { disconnectedAt: null, phoneNumbers: { some: { deletedAt: null, isActive: true } } },
      orderBy: [{ producerId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        wabaId: true,
        wabaName: true,
        accessToken: true,
        producer: { select: { id: true, name: true } },
        phoneNumbers: {
          where: { deletedAt: null, isActive: true },
          orderBy: { id: 'asc' },
          select: { phoneNumberId: true, number: true, branchName: true },
        },
      },
    })
    const campaigns = await this.prisma.salesCampaign.findMany({
      where: {
        deletedAt: null,
        templateVersion: { gt: 0 },
        producerId: { in: [...new Set(accounts.map(a => a.producer.id))] },
      },
      select: { producerId: true, kind: true, templateVersion: true },
    })
    const notices = this.noticeTemplates()

    const views = await Promise.all(
      accounts.map(account => {
        const current: ExpectedTemplate[] = campaigns
          .filter(c => c.producerId === account.producer.id)
          .map(c => {
            const definition = campaignOfDbKind(c.kind)
            return {
              name: `${definition.templateSlug}_v${c.templateVersion}`,
              lang: 'es_AR',
              use: `Campaña: ${definition.label}`,
            }
          })
        return this.accountView(account, [...notices, ...current])
      }),
    )

    const organizations: TemplatesOverview['organizations'] = []
    accounts.forEach((account, index) => {
      let org = organizations.find(o => o.id === account.producer.id)
      if (!org) {
        org = { id: account.producer.id, name: account.producer.name, accounts: [] }
        organizations.push(org)
      }
      org.accounts.push(views[index])
    })
    return { checkedAt: new Date().toISOString(), organizations }
  }

  private async accountView(
    account: {
      id: number
      wabaId: string
      wabaName: string | null
      accessToken: string
      phoneNumbers: Array<{ phoneNumberId: string; number: string; branchName: string | null }>
    },
    expected: ExpectedTemplate[],
  ): Promise<TemplatesAccountView> {
    const [templates, numbers] = await Promise.allSettled([
      this.templates.templatesOf(account),
      this.templates.numbersOf(account),
    ])
    const fromMeta: MetaPhoneNumber[] = numbers.status === 'fulfilled' ? numbers.value : []
    const meta: MetaTemplate[] | null = templates.status === 'fulfilled' ? templates.value : null
    return {
      id: account.id,
      wabaName: account.wabaName,
      numbers: account.phoneNumbers.map(p => {
        const reported = fromMeta.find(n => n.id === p.phoneNumberId)
        return {
          number: p.number,
          branchName: p.branchName,
          quality: reported?.quality ?? null,
          messagingLimit: reported?.messagingLimit ?? null,
        }
      }),
      error: meta ? null : failure(templates.status === 'rejected' ? templates.reason : null),
      templates: meta ? accountRows(meta, expected) : [],
    }
  }

  private noticeTemplates(): ExpectedTemplate[] {
    return NOTICE_TEMPLATES.flatMap(notice => {
      const name = this.config.get<string>(notice.env)
      if (!name) return []
      return [{ name, lang: this.config.get<string>(`${notice.env}_LANG`) || 'es_AR', use: notice.use }]
    })
  }
}

function failure(reason: unknown): string {
  return reason instanceof MetaGraphError
    ? `Meta no devolvió las plantillas de esta cuenta: ${reason.message}`
    : 'Meta no devolvió las plantillas de esta cuenta.'
}
