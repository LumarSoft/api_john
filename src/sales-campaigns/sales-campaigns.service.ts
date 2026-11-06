import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma, SalesCampaignMessageStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeUser } from '../common/scope/scope.service'
import { whatsAppIds } from '../common/phone-match'
import { BotNotifierService } from '../inbox/bot-notifier.service'
import { describeFailure, pickSender, pickWhatsApp, SEND_GAP_MS, Sender, sleep } from '../notices/notice-delivery'
import { NoticeDeliveryService } from '../notices/notice-delivery.service'
import { FEATURE_NOT_FOR_ROLE, FEATURE_NOT_IN_PLAN } from '../plan-features/plan-features'
import { PlanFeaturesService } from '../plan-features/plan-features.service'
import {
  CAMPAIGNS,
  CANCELLATION_REASON_LABELS,
  CANCELLATION_REASONS,
  CampaignDefinition,
  campaignOf,
  campaignOfDbKind,
  exampleValues,
  numberSetting,
  renderBody,
  settingsOf,
  templateParams,
  validateBody,
  withSettings,
} from './campaign-catalog'
import { CampaignFinderService, CampaignTarget, formatDay } from './campaign-finder.service'
import { CampaignTemplatesService, StoredTemplates } from './campaign-templates.service'
import { CampaignSortField, ListCampaignCandidatesDto, SortOrder } from './dto/list-campaign-candidates.dto'
import { UpdateSalesCampaignDto } from './dto/update-sales-campaign.dto'

const { SENDING, SENT, FAILED, MARKED } = SalesCampaignMessageStatus
const DAY_MS = 86_400_000
const LANGUAGE = 'es_AR'

/** A campaign is not refreshed against Meta more often than this from the panel. */
const REFRESH_EVERY_MS = 5 * 60_000

export const CAMPAIGN_SKIP = {
  NO_PHONE: 'NO_PHONE',
  ALREADY_SENT: 'ALREADY_SENT',
  SENDING: 'SENDING',
  OPTED_OUT: 'OPTED_OUT',
} as const
type CampaignSkip = (typeof CAMPAIGN_SKIP)[keyof typeof CAMPAIGN_SKIP]

type CampaignRow = Prisma.SalesCampaignGetPayload<object>

interface MessageSummary {
  status: SalesCampaignMessageStatus
  sentAt: Date | null
  createdAt: Date
  error: string | null
  clientId: number | null
  waId: string | null
  policyId: number | null
  quoteId: number | null
}

/**
 * The sales campaigns of Nico's proposal. Each organization turns a campaign
 * on, writes its message and its discount, and the panel lists who the
 * campaign finds in the portfolio; the office ticks who to write to. Every
 * message goes out with the organization's own Meta template (MARKETING),
 * only from numbers whose plan includes the campaign and whose WhatsApp
 * account has the template approved. A client who answers lands in the
 * office's chat like the replies to a rechazo.
 */
@Injectable()
export class SalesCampaignsService implements OnModuleInit {
  private readonly logger = new Logger(SalesCampaignsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly finder: CampaignFinderService,
    private readonly templates: CampaignTemplatesService,
    private readonly planFeatures: PlanFeaturesService,
    private readonly delivery: NoticeDeliveryService,
    private readonly botNotifier: BotNotifierService,
  ) {}

  /** A restart in the middle of a send leaves messages in SENDING forever. */
  async onModuleInit() {
    const { count } = await this.prisma.salesCampaignMessage.updateMany({
      where: { status: SENDING },
      data: {
        status: FAILED,
        error: 'El envío se cortó por un reinicio del sistema: revisá el chat antes de reintentar.',
      },
    })
    if (count) this.logger.warn(`${count} mensajes de campaña quedaron a medio enviar tras un reinicio`)
  }

  // ─── Set-up ────────────────────────────────────────────

  /** Every campaign of the organization, configured or not, with how many clients it finds in the user's scope. */
  async list(user: ScopeUser, codeIds: number[], now = new Date()) {
    const [rows, plans, accounts] = await Promise.all([
      this.prisma.salesCampaign.findMany({ where: { producerId: user.producerId, deletedAt: null } }),
      this.planFeatures.forUser(user),
      this.templates.accounts(user.producerId),
    ])
    const byKind = new Map(rows.map(r => [campaignOfDbKind(r.kind).kind, r]))
    this.refreshStale(rows)
    const campaigns = await Promise.all(
      Object.values(CAMPAIGNS).map(async definition => {
        const row = byKind.get(definition.kind) ?? null
        const settings = settingsOf(definition, row?.settings)
        const targets = await this.finder.find(definition, settings, user.producerId, codeIds, now)
        return this.view(definition, row, plans, accounts, targets.length)
      }),
    )
    return { campaigns }
  }

  async update(user: ScopeUser, kind: string, dto: UpdateSalesCampaignDto, codeIds: number[]) {
    const definition = campaignOf(kind)
    const current = await this.findRow(user.producerId, definition)
    const plans = await this.planFeatures.forUser(user)
    if (plans.blockedByRole.includes(definition.feature)) throw new ForbiddenException(FEATURE_NOT_FOR_ROLE)
    if (dto.enabled === true && !plans.features[definition.feature]) {
      throw new ForbiddenException(FEATURE_NOT_IN_PLAN[definition.feature])
    }

    const body = dto.body !== undefined ? validateBody(definition, dto.body) : (current?.body ?? definition.defaultBody)
    const settings = dto.settings !== undefined ? withSettings(definition, current?.settings, dto.settings) : undefined
    const enabled = dto.enabled ?? current?.enabled ?? false
    // A new text, or the first time it is turned on, goes to Meta's review as a new template.
    const textChanged = dto.body !== undefined && body !== (current?.body ?? definition.defaultBody)
    const neverSubmitted = (current?.templateVersion ?? 0) === 0
    const submit = textChanged || (enabled && neverSubmitted)
    const version = submit ? (current?.templateVersion ?? 0) + 1 : (current?.templateVersion ?? 0)
    const templates = submit
      ? await this.templates.submit(user.producerId, definition, body, version)
      : ((current?.templates as StoredTemplates | null) ?? null)

    const data = {
      enabled,
      body,
      ...(dto.discountPercent !== undefined ? { discountPercent: dto.discountPercent } : {}),
      ...(settings ? { settings } : {}),
      templateVersion: version,
      templates: templates ? (templates as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      updatedById: user.id,
    }
    await this.prisma.salesCampaign.upsert({
      where: { producerId_kind: { producerId: user.producerId, kind: definition.dbKind } },
      create: { producerId: user.producerId, kind: definition.dbKind, ...data },
      update: data,
    })
    return this.one(user, definition, codeIds)
  }

  /** Asks Meta again how the campaign's templates are doing. */
  async refreshTemplates(user: ScopeUser, kind: string, codeIds: number[]) {
    const definition = campaignOf(kind)
    const row = await this.findRow(user.producerId, definition)
    if (row && row.templateVersion > 0) {
      await this.refreshRow(row)
      // A number connected after the last text: its account gets the current one.
      await this.submitToNewAccounts(row)
    }
    return this.one(user, definition, codeIds)
  }

  /**
   * Every campaign text of the organization (or of all of them) sent to the
   * WhatsApp accounts that do not have it yet: a number connected after the
   * last text gets the current one without anybody touching the campaign.
   * Returns how many templates went to Meta.
   */
  async syncNewAccounts(producerId?: number): Promise<number> {
    const rows = await this.prisma.salesCampaign.findMany({
      where: { deletedAt: null, templateVersion: { gt: 0 }, ...(producerId != null ? { producerId } : {}) },
    })
    let submitted = 0
    for (const row of rows) submitted += await this.submitToNewAccounts(row)
    return submitted
  }

  /** The campaign's current text to the accounts of its organization that do not have it. */
  private async submitToNewAccounts(row: CampaignRow): Promise<number> {
    const stored = (row.templates as unknown as StoredTemplates | null) ?? {}
    const missing = (await this.templates.accounts(row.producerId)).filter(a => {
      const template = stored[String(a.id)]
      // Never there, or it did not reach Meta (or Meta lost it) a day ago: send it again.
      return !template || (template.status === 'ERROR' && Date.now() - Date.parse(template.checkedAt) > DAY_MS)
    })
    if (!missing.length) return 0
    const definition = campaignOfDbKind(row.kind)
    const added = await this.templates.submit(row.producerId, definition, row.body, row.templateVersion, missing)
    // Read again: a send or a refresh may have written the row meanwhile.
    const current = await this.prisma.salesCampaign.findUnique({ where: { id: row.id }, select: { templates: true } })
    await this.prisma.salesCampaign.update({
      where: { id: row.id },
      data: {
        templates: { ...((current?.templates as object | null) ?? {}), ...added } as unknown as Prisma.InputJsonValue,
      },
    })
    return missing.length
  }

  /** Templates still in review, every half hour, so the panel is not the only one asking. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshPending(): Promise<void> {
    const rows = await this.prisma.salesCampaign.findMany({
      where: { deletedAt: null, templates: { not: Prisma.DbNull } },
    })
    for (const row of rows) {
      if (this.templates.hasPending(row.templates as unknown as StoredTemplates)) await this.refreshRow(row)
    }
  }

  // ─── Who to write to ───────────────────────────────────

  async candidates(
    user: ScopeUser,
    kind: string,
    codeIds: number[],
    query: ListCampaignCandidatesDto,
    now = new Date(),
  ) {
    const definition = campaignOf(kind)
    const row = await this.findRow(user.producerId, definition)
    const settings = settingsOf(definition, row?.settings)
    const targets = await this.finder.find(definition, settings, user.producerId, codeIds, now)
    const [messages, optedOut] = await Promise.all([
      row ? this.recentMessages(row.id, now) : Promise.resolve([]),
      this.optedOutWaIds(user.producerId),
    ])

    const search = (query.search ?? '').trim().toLowerCase()
    const coverage = query.coverage?.trim().toUpperCase()
    const listed = targets
      .filter(t => !search || [t.name, t.dni, t.item, t.detail].some(v => v?.toLowerCase().includes(search)))
      .filter(t => !coverage || t.coverages.some(c => c.toUpperCase() === coverage))
      .filter(t => !query.reason || t.reason === query.reason)
      .map(t => {
        const last = this.lastMessageFor(t, definition, messages)
        const row = {
          id: t.id,
          client: { id: t.clientId, name: t.name, dni: t.dni, phone: t.phone ?? (t.waId ? `+${t.waId}` : null) },
          item: t.item,
          detail: t.detail,
          date: t.date?.toISOString() ?? null,
          producerCode: t.producerCode,
          // What the message fills in for this person, so the panel's preview reads exactly like it.
          values: this.personalValues(t),
          lastMessage: last
            ? {
                status: last.status,
                sentAt: last.sentAt?.toISOString() ?? null,
                createdAt: last.createdAt.toISOString(),
                error: last.error,
              }
            : null,
          optedOut: this.isOptedOut(t, optedOut),
        }
        const lastAt = last ? (last.sentAt ?? last.createdAt).getTime() : null
        return { row, sortDate: t.sortDate?.getTime() ?? 0, lastAt }
      })

    // Who was already written to (or said no) goes after the rest, so the list
    // works as a to-do, unless the office sorts by the last message itself.
    const sort = this.sortOf(definition, query)
    const sign = sort.order === 'asc' ? 1 : -1
    listed.sort((a, b) => {
      if (sort.by !== 'lastMessage') {
        const contacted =
          Number(a.row.lastMessage !== null || a.row.optedOut) - Number(b.row.lastMessage !== null || b.row.optedOut)
        if (contacted) return contacted
      }
      return sign * compareBy(sort.by, a, b) || b.row.id - a.row.id
    })
    const rows = listed.map(l => l.row)

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    return {
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      sort,
      filters: this.filterOptions(definition, targets),
    }
  }

  /**
   * The column and direction the list is sorted by. By default the campaign's
   * date, newest first (who entered the list last), except in renewals: the
   * one that ends soonest, the most urgent.
   */
  private sortOf(
    definition: CampaignDefinition,
    query: ListCampaignCandidatesDto,
  ): { by: CampaignSortField; order: SortOrder } {
    if (query.sort === 'recent') return { by: 'date', order: 'desc' }
    if (query.sort === 'oldest') return { by: 'date', order: 'asc' }
    const by = query.sort ?? 'date'
    const natural: SortOrder =
      by === 'name' || by === 'item' || (by === 'date' && definition.kind === 'renewal') ? 'asc' : 'desc'
    return { by, order: query.order ?? natural }
  }

  /**
   * The choices of the campaign's filters, from everyone it finds in the
   * user's scope (not only the page or the search), with how many each has.
   */
  private filterOptions(definition: CampaignDefinition, targets: CampaignTarget[]) {
    const coverages = new Map<string, { value: string; count: number }>()
    if (definition.filters.includes('coverage')) {
      for (const t of targets) {
        for (const code of t.coverages) {
          const option = coverages.get(code.toUpperCase()) ?? { value: code, count: 0 }
          option.count++
          coverages.set(code.toUpperCase(), option)
        }
      }
    }
    return {
      coverages: definition.filters.includes('coverage')
        ? [...coverages.values()].sort((a, b) => a.value.localeCompare(b.value, 'es', { numeric: true }))
        : null,
      reasons: definition.filters.includes('reason')
        ? CANCELLATION_REASONS.map(value => ({
            value,
            label: CANCELLATION_REASON_LABELS[value],
            count: targets.filter(t => t.reason === value).length,
          })).filter(option => option.count > 0)
        : null,
    }
  }

  // ─── Sending ───────────────────────────────────────────

  /**
   * Writes to the ticked clients one by one in the background (the panel polls
   * the list while any is SENDING). Someone without WhatsApp, written to within
   * the cooldown, still going out or who asked not to get these is left out.
   */
  async send(user: ScopeUser, kind: string, codeIds: number[], ids: number[], now = new Date()) {
    const definition = campaignOf(kind)
    await this.planFeatures.assertRole(user, definition.feature)
    const row = await this.findRow(user.producerId, definition)
    if (!row?.enabled) throw new ConflictException('La campaña está apagada. Prendela para enviar.')

    // Numbers whose plan includes the campaign (403 when none does)...
    const planSenders = await this.delivery.senders(user.producerId, definition.feature)
    if (!planSenders.length) {
      throw new ConflictException('No hay un número de WhatsApp conectado para enviar. Revisalo en Números.')
    }
    // ...in an account where Meta approved the campaign's message.
    const approved = this.templates.approvedAccounts((row.templates as unknown as StoredTemplates) ?? {})
    const senders = planSenders.filter(s => s.wabaAccountId != null && approved.has(s.wabaAccountId))
    if (!senders.length) {
      throw new ConflictException(
        'Meta todavía no aprobó el mensaje de esta campaña en las cuentas de WhatsApp que pueden enviarla.',
      )
    }

    const settings = settingsOf(definition, row.settings)
    const targets = await this.finder.find(definition, settings, user.producerId, codeIds, now, ids)
    const [messages, optedOut] = await Promise.all([
      this.recentMessages(row.id, now),
      this.optedOutWaIds(user.producerId),
    ])
    const known = await this.delivery.knownWaIds(
      user.producerId,
      targets.flatMap(t => (t.phone ? [t.phone] : [])),
    )
    const cooldownFrom = new Date(now.getTime() - numberSetting(settings, 'cooldownDays') * DAY_MS)

    const claimed: number[] = []
    const skipped: Array<{ id: number; reason: CampaignSkip }> = []
    for (const target of targets) {
      const last = this.lastMessageFor(target, definition, messages)
      const waId = target.waId ?? pickWhatsApp([target.phone], known)?.waId ?? null
      const reason: CampaignSkip | null =
        last?.status === SENDING
          ? CAMPAIGN_SKIP.SENDING
          : last && (last.status === SENT || last.status === MARKED) && last.createdAt >= cooldownFrom
            ? CAMPAIGN_SKIP.ALREADY_SENT
            : this.isOptedOut(target, optedOut)
              ? CAMPAIGN_SKIP.OPTED_OUT
              : !waId
                ? CAMPAIGN_SKIP.NO_PHONE
                : null
      if (reason) {
        skipped.push({ id: target.id, reason })
        continue
      }
      const message = await this.prisma.salesCampaignMessage.create({
        data: {
          status: SENDING,
          phone: target.phone,
          waId,
          discountPercent: row.discountPercent,
          campaignId: row.id,
          producerId: user.producerId,
          producerCodeId: target.producerCodeId,
          clientId: target.clientId,
          ...this.targetRef(definition, target),
          conversationId: target.conversationId,
          sentById: user.id,
        },
        select: { id: true },
      })
      claimed.push(message.id)
    }
    if (!claimed.length) throw new BadRequestException('A ninguno de los elegidos se le puede escribir ahora.')

    const values = new Map(targets.map(t => [t.id, t]))
    void this.deliverAll(claimed, { definition, row, senders, approved, values }).catch(error =>
      this.logger.error(`Se cortó el envío de la campaña ${definition.kind}: ${(error as Error).message}`),
    )
    return { sent: claimed.length, skipped }
  }

  /** The office reached these clients by other means: they are not offered again for the cooldown. */
  async mark(user: ScopeUser, kind: string, codeIds: number[], ids: number[], now = new Date()) {
    const definition = campaignOf(kind)
    await this.planFeatures.assertRole(user, definition.feature)
    const row = await this.ensureRow(user, definition)
    const targets = await this.finder.find(
      definition,
      settingsOf(definition, row.settings),
      user.producerId,
      codeIds,
      now,
      ids,
    )
    const messages = await this.recentMessages(row.id, now)
    const marked = targets.filter(t => this.lastMessageFor(t, definition, messages)?.status !== SENDING)
    if (marked.length) {
      await this.prisma.salesCampaignMessage.createMany({
        data: marked.map(t => ({
          status: MARKED,
          sentAt: now,
          phone: t.phone,
          waId: t.waId,
          campaignId: row.id,
          producerId: user.producerId,
          producerCodeId: t.producerCodeId,
          clientId: t.clientId,
          ...this.targetRef(definition, t),
          conversationId: t.conversationId,
          sentById: user.id,
        })),
      })
    }
    return { marked: marked.length }
  }

  /** These people asked not to get campaign messages: no campaign of the organization offers them again. */
  async optOut(user: ScopeUser, kind: string, codeIds: number[], ids: number[], now = new Date()) {
    const definition = campaignOf(kind)
    await this.planFeatures.assertRole(user, definition.feature)
    const row = await this.findRow(user.producerId, definition)
    const targets = await this.finder.find(
      definition,
      settingsOf(definition, row?.settings),
      user.producerId,
      codeIds,
      now,
      ids,
    )
    // Every reading of the phone: an ambiguous mobile must not slip through by the other one.
    const waIds = new Set<string>()
    for (const t of targets) {
      if (t.waId) waIds.add(t.waId)
      else whatsAppIds(t.phone).forEach(id => waIds.add(id))
    }
    for (const waId of waIds) {
      await this.prisma.salesCampaignOptOut.upsert({
        where: { producerId_waId: { producerId: user.producerId, waId } },
        create: { producerId: user.producerId, waId, createdById: user.id },
        update: { deletedAt: null, createdById: user.id },
      })
    }
    return { optedOut: waIds.size }
  }

  private async deliverAll(
    ids: number[],
    ctx: {
      definition: CampaignDefinition
      row: CampaignRow
      senders: Sender[]
      approved: Map<number, string>
      values: Map<number, CampaignTarget>
    },
  ) {
    for (const [index, id] of ids.entries()) {
      if (index > 0) await sleep(SEND_GAP_MS)
      try {
        await this.deliverOne(id, ctx)
      } catch (error) {
        this.logger.error(`Mensaje de campaña ${id}: ${(error as Error).message}`)
        await this.prisma.salesCampaignMessage.updateMany({
          where: { id, status: SENDING },
          data: { status: FAILED, error: 'No se pudo enviar el mensaje. Probá de nuevo en unos minutos.' },
        })
      }
    }
  }

  private async deliverOne(
    id: number,
    ctx: {
      definition: CampaignDefinition
      row: CampaignRow
      senders: Sender[]
      approved: Map<number, string>
      values: Map<number, CampaignTarget>
    },
  ) {
    const message = await this.prisma.salesCampaignMessage.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        waId: true,
        producerId: true,
        producerCodeId: true,
        clientId: true,
        policyId: true,
        quoteId: true,
        discountPercent: true,
      },
    })
    const waId = message.waId
    if (!waId) throw new InternalServerErrorException('Campaign message has no WhatsApp id')
    const target = ctx.values.get(message.quoteId ?? message.policyId ?? -1)
    if (!target) throw new InternalServerErrorException('Campaign message lost its target')

    const values = this.valuesFor(target, message.discountPercent ?? ctx.row.discountPercent)
    const body = ctx.row.body
    const existing = await this.delivery.findConversation(waId, message.producerId)
    const phoneNumberId = pickSender(ctx.senders, existing?.phoneNumberId, message.producerCodeId)
    const sender = ctx.senders.find(s => s.phoneNumberId === phoneNumberId)
    const template = sender?.wabaAccountId != null ? ctx.approved.get(sender.wabaAccountId) : undefined
    if (!template) throw new InternalServerErrorException('Sender has no approved template')

    try {
      await this.botNotifier.sendTemplate({
        to: waId,
        phoneNumberId,
        template,
        lang: LANGUAGE,
        params: templateParams(body, values),
      })
    } catch (error) {
      await this.prisma.salesCampaignMessage.update({
        where: { id },
        data: { status: FAILED, error: describeFailure(error) },
      })
      return
    }

    try {
      const conversationId = await this.delivery.recordInChat(
        { waId, producerId: message.producerId, producerCodeId: message.producerCodeId, clientId: message.clientId },
        existing,
        phoneNumberId,
        renderBody(body, values),
        { salesCampaignMessageId: message.id, campaign: ctx.definition.kind, notice: 'sales_campaign' },
      )
      await this.prisma.salesCampaignMessage.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: null, conversationId },
      })
    } catch (error) {
      // WhatsApp already took it: it must not look unsent and go out twice.
      this.logger.error(`Mensaje de campaña ${id} enviado pero no guardado en el chat: ${(error as Error).message}`)
      await this.prisma.salesCampaignMessage.update({
        where: { id },
        data: { status: SENT, sentAt: new Date(), error: 'Se envió, pero no quedó registrado en el chat del panel.' },
      })
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async one(user: ScopeUser, definition: CampaignDefinition, codeIds: number[]) {
    const [row, plans, accounts] = await Promise.all([
      this.findRow(user.producerId, definition),
      this.planFeatures.forUser(user),
      this.templates.accounts(user.producerId),
    ])
    const targets = await this.finder.find(definition, settingsOf(definition, row?.settings), user.producerId, codeIds)
    return this.view(definition, row, plans, accounts, targets.length)
  }

  private view(
    definition: CampaignDefinition,
    row: CampaignRow | null,
    plans: Awaited<ReturnType<PlanFeaturesService['forUser']>>,
    accounts: Awaited<ReturnType<CampaignTemplatesService['accounts']>>,
    candidates: number,
  ) {
    const body = row?.body ?? definition.defaultBody
    const stored = (row?.templates as unknown as StoredTemplates | null) ?? {}
    const templates = this.templates.view(accounts, stored)
    const examples = exampleValues(definition)
    const discountPercent = row?.discountPercent ?? 15
    return {
      kind: definition.kind,
      label: definition.label,
      description: definition.description,
      enabled: row?.enabled ?? false,
      discountPercent,
      body,
      placeholders: definition.placeholders,
      settings: settingsOf(definition, row?.settings),
      settingFields: definition.settingFields,
      filters: definition.filters,
      templates,
      ready: templates.some(t => t.status === 'APPROVED'),
      plan: {
        included: plans.features[definition.feature],
        availableIn: plans.availableIn[definition.feature],
        // The plans include it but the user's role has it off.
        byRole: plans.blockedByRole.includes(definition.feature),
      },
      candidates,
      preview: renderBody(body, { ...examples, porcentaje: String(discountPercent) }),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
  }

  private valuesFor(target: CampaignTarget, discountPercent: number): Record<string, string> {
    return { ...this.personalValues(target), porcentaje: String(discountPercent) }
  }

  private personalValues(target: CampaignTarget): Record<string, string> {
    return {
      nombre: metaSafe(target.firstName),
      bien: metaSafe(target.bien),
      vencimiento: formatDay(target.date),
    }
  }

  private targetRef(definition: CampaignDefinition, target: CampaignTarget) {
    return definition.kind === 'quote_followup' ? { quoteId: target.id } : { policyId: target.id }
  }

  private findRow(producerId: number, definition: CampaignDefinition) {
    return this.prisma.salesCampaign.findFirst({ where: { producerId, kind: definition.dbKind, deletedAt: null } })
  }

  /** The campaign's row, created with the defaults when the office acts on one it never configured. */
  private ensureRow(user: ScopeUser, definition: CampaignDefinition) {
    return this.prisma.salesCampaign.upsert({
      where: { producerId_kind: { producerId: user.producerId, kind: definition.dbKind } },
      create: { producerId: user.producerId, kind: definition.dbKind, body: definition.defaultBody },
      update: {},
    })
  }

  /** The campaign's messages of the last year (the longest cooldown), newest first. */
  private recentMessages(campaignId: number, now: Date): Promise<MessageSummary[]> {
    return this.prisma.salesCampaignMessage.findMany({
      where: { campaignId, deletedAt: null, createdAt: { gte: new Date(now.getTime() - 366 * DAY_MS) } },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        sentAt: true,
        createdAt: true,
        error: true,
        clientId: true,
        waId: true,
        policyId: true,
        quoteId: true,
      },
    })
  }

  /** The person's latest message of the campaign: by client (any of their policies) or by WhatsApp. */
  private lastMessageFor(target: CampaignTarget, definition: CampaignDefinition, messages: MessageSummary[]) {
    return messages.find(m =>
      definition.kind === 'quote_followup'
        ? m.quoteId === target.id || (target.waId != null && m.waId === target.waId)
        : m.policyId === target.id || (target.clientId != null && m.clientId === target.clientId),
    )
  }

  private async optedOutWaIds(producerId: number): Promise<Set<string>> {
    const rows = await this.prisma.salesCampaignOptOut.findMany({
      where: { producerId, deletedAt: null },
      select: { waId: true },
    })
    return new Set(rows.map(r => r.waId))
  }

  private isOptedOut(target: CampaignTarget, optedOut: Set<string>): boolean {
    if (!optedOut.size) return false
    if (target.waId) return optedOut.has(target.waId)
    return whatsAppIds(target.phone).some(id => optedOut.has(id))
  }

  /** Campaigns waiting for Meta, refreshed in the background when the panel opens. */
  private refreshStale(rows: CampaignRow[]) {
    const now = Date.now()
    for (const row of rows) {
      const stored = (row.templates as unknown as StoredTemplates | null) ?? {}
      const pending = Object.values(stored).filter(t => t.status === 'PENDING' || t.status === 'ERROR')
      if (pending.some(t => now - Date.parse(t.checkedAt) > REFRESH_EVERY_MS)) {
        void this.refreshRow(row).catch(error =>
          this.logger.warn(`No se pudo consultar a Meta la campaña ${row.id}: ${(error as Error).message}`),
        )
      }
    }
  }

  private async refreshRow(row: CampaignRow) {
    const stored = (row.templates as unknown as StoredTemplates | null) ?? {}
    const refreshed = await this.templates.refresh(row.producerId, stored)
    await this.prisma.salesCampaign.update({
      where: { id: row.id },
      data: { templates: refreshed as unknown as Prisma.InputJsonValue },
    })
  }
}

/** Meta rejects template variables with new lines, tabs or runs of spaces. */
function metaSafe(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

interface SortableRow {
  row: { client: { name: string }; item: string }
  sortDate: number
  /** When the campaign last wrote to them; null = never. */
  lastAt: number | null
}

/** Ascending order of two rows by one column; never contacted counts as the oldest message. */
function compareBy(by: CampaignSortField, a: SortableRow, b: SortableRow): number {
  switch (by) {
    case 'name':
      return a.row.client.name.localeCompare(b.row.client.name, 'es', { sensitivity: 'base' })
    case 'item':
      return a.row.item.localeCompare(b.row.item, 'es', { sensitivity: 'base', numeric: true })
    case 'lastMessage':
      return (a.lastAt ?? -Infinity) - (b.lastAt ?? -Infinity) || 0
    case 'date':
      return a.sortDate - b.sortDate
  }
}
