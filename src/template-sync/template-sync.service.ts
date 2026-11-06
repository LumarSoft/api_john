import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { latestVersion, NOTICE_TEMPLATES, type NoticeTemplate } from '../notices/notice-templates'
import { WabaTemplatesService, type MetaTemplate, type WabaAccountRef } from '../notices/waba-templates.service'
import { SalesCampaignsService } from '../sales-campaigns/sales-campaigns.service'

/** What one pass did. */
export interface TemplateSyncResult {
  /** Notice templates created in Meta. */
  notices: number
  /** Campaign texts sent to accounts that did not have them. */
  campaigns: number
}

/**
 * Meta keeps each template inside one WhatsApp account, and every number
 * connected with Coexistence brings an account of its own, so a template would
 * have to be created by hand in each one. This does it: in every account that
 * can send, it creates the newest version of each notice that is on
 * (src/notices/notice-templates.ts) and sends each campaign's current text
 * (SalesCampaignsService). Meta reviews each copy apart; the panel shows where
 * each one stands.
 *
 * Runs every hour and right after a number is connected. Off unless
 * META_TEMPLATE_SYNC_ENABLED=true: an API running elsewhere with a copy of the
 * accounts must never create templates in the real ones.
 */
@Injectable()
export class TemplateSyncService {
  private readonly logger = new Logger(TemplateSyncService.name)
  /** One pass at a time; a connection during a pass waits for it. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly templates: WabaTemplatesService,
    private readonly campaigns: SalesCampaignsService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('META_TEMPLATE_SYNC_ENABLED') === 'true'
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncAll(): Promise<void> {
    if (!this.enabled) return
    await this.exclusive(() => this.sync()).catch(error =>
      this.logger.error(`No se pudieron sincronizar las plantillas: ${(error as Error).message}`),
    )
  }

  /** Right after a number is connected: its account gets the templates without waiting for the hour. Never throws. */
  syncAccountSoon(wabaAccountId: number): void {
    if (!this.enabled) return
    void this.exclusive(() => this.sync(wabaAccountId)).catch(error =>
      this.logger.error(
        `No se pudieron crear las plantillas de la cuenta ${wabaAccountId}: ${(error as Error).message}`,
      ),
    )
  }

  /** One pass over every account that can send, or only `wabaAccountId`'s. */
  async sync(wabaAccountId?: number): Promise<TemplateSyncResult> {
    const accounts = await this.prisma.wabaAccount.findMany({
      where: {
        disconnectedAt: null,
        phoneNumbers: { some: { deletedAt: null, isActive: true } },
        ...(wabaAccountId != null ? { id: wabaAccountId } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true, wabaId: true, accessToken: true, producerId: true },
    })
    const notices = Object.values(NOTICE_TEMPLATES).filter(t => !!this.config.get<string>(t.env))

    let created = 0
    for (const account of accounts) created += await this.createMissingNotices(account, notices)

    // Campaign texts are per organization: only the connected account's one, or all of them.
    const organizations = wabaAccountId != null ? [...new Set(accounts.map(a => a.producerId))] : [undefined]
    let campaigns = 0
    for (const producerId of organizations) campaigns += await this.campaigns.syncNewAccounts(producerId)

    if (created || campaigns) {
      this.logger.log(`Plantillas: ${created} avisos creados y ${campaigns} textos de campaña mandados a Meta`)
    }
    return { notices: created, campaigns }
  }

  /** The newest version of each notice, created where the account does not have it in any state. */
  private async createMissingNotices(account: WabaAccountRef, notices: NoticeTemplate[]): Promise<number> {
    if (!notices.length) return 0
    let existing: MetaTemplate[]
    try {
      existing = await this.templates.templatesOf(account)
    } catch (error) {
      this.logger.warn(`No se pudieron leer las plantillas de la cuenta ${account.id}: ${(error as Error).message}`)
      return 0
    }
    let created = 0
    for (const notice of notices) {
      const version = latestVersion(notice)
      if (existing.some(t => t.name === version.name && t.language === notice.lang)) continue
      const result = await this.templates.createTemplate(account, {
        name: version.name,
        lang: notice.lang,
        category: notice.category,
        body: version.body,
        example: version.variables.map(key => notice.examples[key] ?? key),
      })
      if (result.ok) {
        created++
        this.logger.log(`Plantilla ${version.name} creada en la cuenta ${account.id}: queda en revisión de Meta`)
      } else {
        this.logger.warn(`Meta no creó la plantilla ${version.name} en la cuenta ${account.id}: ${result.reason}`)
      }
    }
    return created
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }
}
