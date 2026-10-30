import { metaMessageRate } from './meta-rates'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommercialPricing, readCommercialPricing } from './commercial-pricing'
import { initialPlanId } from './initial-plan'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'

export interface RecordOpenAiInput {
  /** Meta phone_number_id the LLM call was for. */
  metaPhoneNumberId: string
  model?: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** Seconds of audio, for transcription models (billed per minute, not per token). */
  audioSeconds?: number
  requestId?: string
  timestamp?: number
}

export interface RecordMetaInput {
  metaPhoneNumberId: string
  messageId: string
  category: string
  billable: boolean
  recipient: string
  timestamp: number
}

export interface MonthlyBillableUsage {
  openaiInputTokens?: number
  openaiOutputTokens?: number
  openaiCalls?: number
  /** Messages the platform sent this month: the unit every plan counts. */
  metaMessages?: number
}

/** A plan of the platform's catalog (MessagePlan row), as billing reads it. */
export interface CatalogPlan {
  id: number
  name: string
  messages: number
  priceUsd: number
  isTrial: boolean
  /** Off: no number moves to it any more, but the numbers already on it stay. */
  isActive: boolean
}

/** A number as billing needs it. */
export interface BillablePhone {
  isActive: boolean
  /** First message the number ever recorded; null = never in service. */
  serviceStartedAt: Date | null
  /** The plan the SuperAdmin assigned (null = the smallest paid plan). */
  planId: number | null
  /** Blocks past the largest plan accepted for the month being billed (acceptedBlocks). */
  extraBlocks?: number
}

/** The plan a month is billed on: a catalog plan, or the largest plus blocks past the catalog. */
export interface BilledPlan {
  /** The catalog plan, or null past the largest plan. */
  id: number | null
  name: string
  includedMessages: number
  priceUsd: number
  /** The free first-month plan of a new account. */
  trial: boolean
  /** Blocks of `blockMessages` past the largest plan (0 inside the catalog). */
  extraBlocks: number
}

export interface MonthlyBill {
  /** Messages the platform sent in the month. */
  messages: number
  /** The plan the number is on before this month's messages (the trial counts only in its first month). */
  assignedPlan: BilledPlan | null
  /** The plan the month is billed on. */
  plan: BilledPlan
  /** True when the month is on blocks accepted past the assigned (largest) plan. */
  upgraded: boolean
  /** The month's messages reached what the plan includes: the assistant pauses until someone chooses. */
  limitReached: boolean
  /** The owner's figure: the plan, prorated in the first month of service. */
  billedUsd: number
  /** True when billedUsd was prorated for the first month of service. */
  prorated: boolean
  /** What the organization is charged: the whole plan, whatever it used (0 when the number is not billed). */
  fullPriceUsd: number
}

/** The number fields usage recording reads (resolvePhone). */
interface PhoneForBilling {
  id: number
  number: string
  phoneNumberId: string
  producerId: number
  responsibleProducerCodeId: number | null
  isActive: boolean
  planId: number | null
  planPausedAt: Date | null
  extraBlocks: number
  extraBlocksPeriod: string | null
}

const ARGENTINA_TZ = 'America/Argentina/Cordoba'

const round2 = (n: number): number => Math.round(n * 100) / 100
const int = (n: number): string => n.toLocaleString('es-AR')

/** Current month key in local time, e.g. "2026-06". */
export function currentPeriod(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`
}

/** First instant of a period in Argentina (UTC-3 all year). */
export function periodStart(period: string): Date {
  return new Date(`${period}-01T00:00:00-03:00`)
}

/** The month after `period` ("2026-10" → "2026-11"). */
export function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

/** Whether a number's assistant is paused for its plan in `period`: it reached the limit that month. */
export function pausedIn(planPausedAt: Date | null | undefined, period: string): boolean {
  return planPausedAt != null && currentPeriod(planPausedAt) === period
}

/** The blocks past the largest plan a number accepted for `period` (they last that month only). */
export function acceptedBlocks(phone: { extraBlocks: number; extraBlocksPeriod: string | null }, period: string) {
  return phone.extraBlocksPeriod === period ? phone.extraBlocks : 0
}

/**
 * Share of the month a number was in service when it went live during it: the
 * day it started counts, so starting on the 1st is the whole month.
 */
function serviceShareOfMonth(period: string, startedAt: Date): number {
  const [year, month] = period.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const startDay = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ, day: 'numeric' }).format(startedAt),
  )
  return (daysInMonth - startDay + 1) / daysInMonth
}

const CATALOG_SELECT = {
  id: true,
  name: true,
  messages: true,
  priceUsd: true,
  isTrial: true,
  isActive: true,
} as const

/**
 * Tracks per-number monthly cost (OpenAI requests/tokens + delivered Meta messages),
 * bills each number on the platform's message plans, and enforces a per-number
 * budget cap on the OpenAI spend. When a number crosses its cap we stamp
 * PhoneNumber.budgetExceededAt; the bot then disables the paid LLM (deterministic
 * flows keep working at zero token cost) until the next month resets the total.
 * Messages are never capped: a busy month moves the number to a bigger plan.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  // GPT-5.6 Luna default pricing (USD per 1M tokens). Override via env.
  private readonly priceInPer1M: number
  private readonly priceOutPer1M: number
  private readonly priceCachedPer1M: number
  private readonly transcribePricePerMinute: number
  private readonly metaMarket: string
  private readonly defaultBudget: number
  /** The block past the largest plan and the trial date (see commercial-pricing.ts). */
  readonly commercialPricing: CommercialPricing

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly mail: MailService,
  ) {
    this.priceInPer1M = Number(config.get('OPENAI_PRICE_IN_PER_1M') ?? 0.2)
    this.priceOutPer1M = Number(config.get('OPENAI_PRICE_OUT_PER_1M') ?? 1.2)
    this.priceCachedPer1M = Number(config.get('OPENAI_PRICE_CACHED_PER_1M') ?? 0.02)
    this.transcribePricePerMinute = Number(config.get('OPENAI_TRANSCRIBE_PRICE_PER_MINUTE') ?? 0.0045)
    this.metaMarket = config.get('META_DEFAULT_MARKET') ?? 'Argentina'
    this.defaultBudget = Number(config.get('DEFAULT_MONTHLY_BUDGET_USD') ?? 20)
    this.commercialPricing = readCommercialPricing(config)
  }

  // ─── Catalog ───────────────────────────────────────────

  /** A MessagePlan row as billing reads it. */
  catalogPlan(row: {
    id: number
    name: string
    messages: number
    priceUsd: unknown
    isTrial: boolean
    isActive: boolean
  }): CatalogPlan {
    return {
      id: row.id,
      name: row.name,
      messages: row.messages,
      priceUsd: Number(row.priceUsd),
      isTrial: row.isTrial,
      isActive: row.isActive,
    }
  }

  /** The platform's catalog (the plans that are switched off included), smallest first. */
  async catalog(): Promise<CatalogPlan[]> {
    const plans = await this.prisma.messagePlan.findMany({
      where: { producerId: null, deletedAt: null },
      orderBy: [{ messages: 'asc' }, { id: 'asc' }],
      select: CATALOG_SELECT,
    })
    return plans.map(p => this.catalogPlan(p))
  }

  /** The plan a new number starts on: the trial for a new account's number, else none (the smallest paid). */
  initialPlanIdFor(producerId: number): Promise<number | null> {
    return initialPlanId(this.prisma, this.commercialPricing, producerId)
  }

  private paidPlans(catalog: CatalogPlan[]): CatalogPlan[] {
    return catalog.filter(p => !p.isTrial).sort((a, b) => a.messages - b.messages || a.id - b.id)
  }

  private asBilled(plan: CatalogPlan): BilledPlan {
    return {
      id: plan.id,
      name: plan.name,
      includedMessages: plan.messages,
      priceUsd: plan.priceUsd,
      trial: plan.isTrial,
      extraBlocks: 0,
    }
  }

  /**
   * The plan a number is on before the month's messages: the one the SuperAdmin
   * assigned, or the smallest paid plan. The trial plan only holds in the
   * number's first month of service (or before it starts).
   */
  assignedPlanFor(planId: number | null, catalog: CatalogPlan[], firstMonth: boolean): BilledPlan | null {
    const assigned = planId != null ? catalog.find(p => p.id === planId) : undefined
    const valid = assigned && (!assigned.isTrial || firstMonth) ? assigned : undefined
    const plan = valid ?? this.paidPlans(catalog.filter(p => p.isActive))[0] ?? this.paidPlans(catalog)[0]
    return plan ? this.asBilled(plan) : null
  }

  /**
   * The plan a month of `messages` is billed on. The assigned plan while it
   * covers them; past it, the smallest active paid plan that covers them; past
   * the largest, that plan plus blocks of `blockMessages` at its price per message.
   */
  planFor(messages: number, assigned: BilledPlan | null, catalog: CatalogPlan[]): BilledPlan {
    if (assigned && messages <= assigned.includedMessages) return assigned
    const paid = this.paidPlans(catalog.filter(p => p.isActive))
    const covering = paid.find(p => p.messages >= messages)
    if (covering) return this.asBilled(covering)
    const largest = paid.at(-1) ?? null
    if (!largest) {
      return { id: null, name: 'Sin plan', includedMessages: messages, priceUsd: 0, trial: false, extraBlocks: 0 }
    }
    const { blockMessages } = this.commercialPricing
    const extraBlocks = Math.max(1, Math.ceil((messages - largest.messages) / blockMessages))
    const includedMessages = largest.messages + extraBlocks * blockMessages
    return {
      id: null,
      name: `${largest.name} + ${int(extraBlocks * blockMessages)}`,
      includedMessages,
      priceUsd: round2((includedMessages * largest.priceUsd) / largest.messages),
      trial: false,
      extraBlocks,
    }
  }

  /** A plan plus `blocks` blocks of `blockMessages`, at the plan's price per message. */
  withBlocks(plan: BilledPlan, blocks: number): BilledPlan {
    if (blocks <= 0 || plan.includedMessages <= 0) return plan
    const { blockMessages } = this.commercialPricing
    const includedMessages = plan.includedMessages + blocks * blockMessages
    return {
      id: null,
      name: `${plan.name} + ${int(blocks * blockMessages)}`,
      includedMessages,
      priceUsd: round2((includedMessages * plan.priceUsd) / plan.includedMessages),
      trial: false,
      extraBlocks: plan.extraBlocks + blocks,
    }
  }

  /** Where a number goes past `current`: the next active paid plan, or one more block past the largest. */
  nextPlanAfter(
    current: BilledPlan,
    catalog: CatalogPlan[],
  ): { name: string; messages: number; priceUsd: number } | null {
    const paid = this.paidPlans(catalog.filter(p => p.isActive))
    const next = paid.find(p => p.messages > current.includedMessages)
    if (next) return { name: next.name, messages: next.messages, priceUsd: next.priceUsd }
    const largest = paid.at(-1)
    if (!largest) return null
    const plan = this.planFor(current.includedMessages + 1, null, catalog)
    return { name: plan.name, messages: plan.includedMessages, priceUsd: plan.priceUsd }
  }

  /**
   * What the organization is invoiced for a number in a month (billed in arrears).
   *
   * One message, one unit. The month is billed on the number's assigned plan
   * while its messages fit, and on the plan that covers them when they do not
   * (planFor). An active number pays at least its plan; in its first month of
   * service, on its own paid plan, that plan is prorated from the day it went
   * live. The trial plan is free and holds only in the first month. A number
   * that never went live, or that was switched off and sent nothing, is not billed.
   */
  billFor(
    phone: BillablePhone,
    usage: MonthlyBillableUsage | undefined,
    catalog: CatalogPlan[],
    period = currentPeriod(),
  ): MonthlyBill {
    const messages = usage?.metaMessages ?? 0
    const startPeriod = phone.serviceStartedAt ? currentPeriod(phone.serviceStartedAt) : null
    const firstMonth = startPeriod === null || startPeriod === period
    const assignedPlan = this.assignedPlanFor(phone.planId, catalog, firstMonth)
    // Never past what the number has: its plan, plus the blocks it accepted. Reaching it pauses the assistant.
    const plan = assignedPlan
      ? this.withBlocks(assignedPlan, phone.extraBlocks ?? 0)
      : this.planFor(messages, null, catalog)
    const upgraded = assignedPlan !== null && plan.includedMessages > assignedPlan.includedMessages
    const limitReached = plan.includedMessages > 0 && messages >= plan.includedMessages
    if (!startPeriod || startPeriod > period || (!phone.isActive && messages === 0)) {
      return { messages, assignedPlan, plan, upgraded, limitReached, billedUsd: 0, prorated: false, fullPriceUsd: 0 }
    }
    const share = firstMonth && !upgraded && !plan.trial ? serviceShareOfMonth(period, phone.serviceStartedAt!) : 1
    return {
      messages,
      assignedPlan,
      plan,
      upgraded,
      limitReached,
      billedUsd: round2(plan.priceUsd * share),
      prorated: share < 1,
      fullPriceUsd: plan.priceUsd,
    }
  }

  /**
   * When each number went live: its first recorded message (or LLM call). Only
   * the events of its first month are read, which keeps the lookup on the
   * (phoneNumberId, period) index; months recorded before events existed fall
   * back to the start of that month.
   */
  async serviceStarts(phoneNumberIds: number[]): Promise<Map<number, Date>> {
    const starts = new Map<number, Date>()
    if (phoneNumberIds.length === 0) return starts
    const firstPeriods = await this.prisma.usageMonthly.groupBy({
      by: ['phoneNumberId'],
      where: { phoneNumberId: { in: phoneNumberIds } },
      _min: { period: true },
    })
    const firsts = firstPeriods.flatMap(f =>
      f._min.period ? [{ phoneNumberId: f.phoneNumberId, period: f._min.period }] : [],
    )
    if (firsts.length === 0) return starts
    const firstEvents = await this.prisma.usageEvent.groupBy({
      by: ['phoneNumberId'],
      where: { OR: firsts },
      _min: { deliveredAt: true },
    })
    const eventAt = new Map(firstEvents.map(e => [e.phoneNumberId, e._min.deliveredAt]))
    for (const f of firsts) starts.set(f.phoneNumberId, eventAt.get(f.phoneNumberId) ?? periodStart(f.period))
    return starts
  }

  private async resolvePhone(metaPhoneNumberId: string) {
    return this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId: metaPhoneNumberId, deletedAt: null },
      select: {
        id: true,
        number: true,
        phoneNumberId: true,
        producerId: true,
        responsibleProducerCodeId: true,
        isActive: true,
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
        planId: true,
        planPausedAt: true,
        extraBlocks: true,
        extraBlocksPeriod: true,
      },
    })
  }

  /** USD for a chat completion; transcription is billed per minute instead (see recordOpenAI). */
  private tokenCost(model: string, inputTokens: number, cached: number, outputTokens: number): number {
    const rates = model.startsWith('gpt-6-luna')
      ? { input: 0.1, cached: 0.01, output: 0.5 }
      : model.startsWith('gpt-5.6-luna')
        ? { input: this.priceInPer1M, cached: this.priceCachedPer1M, output: this.priceOutPer1M }
        : null
    if (!rates) throw new BadRequestException(`Tarifa no configurada para el modelo ${model}`)
    const longContext = inputTokens > 272_000
    return (
      ((inputTokens - cached) * rates.input * (longContext ? 2 : 1) +
        cached * rates.cached * (longContext ? 2 : 1) +
        outputTokens * rates.output * (longContext ? 1.5 : 1)) /
      1_000_000
    )
  }

  async recordOpenAI(input: RecordOpenAiInput): Promise<{ overBudget: boolean }> {
    const phone = await this.resolvePhone(input.metaPhoneNumberId)
    if (!phone) {
      this.logger.warn(`recordOpenAI: unknown phoneNumberId ${input.metaPhoneNumberId}`)
      return { overBudget: false }
    }

    const cached = Math.min(input.inputTokens, Math.max(0, input.cachedInputTokens ?? 0))
    const model = input.model ?? 'gpt-5.6-luna'
    const cost = model.startsWith('gpt-transcribe')
      ? ((input.audioSeconds ?? 0) / 60) * this.transcribePricePerMinute
      : this.tokenCost(model, input.inputTokens, cached, input.outputTokens)
    const deliveredAt = input.timestamp != null ? new Date(input.timestamp * 1000) : new Date()
    const period = currentPeriod(deliveredAt)

    let row: MonthlyBillableUsage & { id: number; openaiCostUsd: unknown }
    try {
      row = await this.prisma.$transaction(async tx => {
        if (input.requestId)
          await tx.usageEvent.create({
            data: {
              eventId: `openai:${input.requestId}`,
              provider: 'openai',
              phoneNumberId: phone.id,
              period,
              category: model,
              billable: true,
              costUsd: cost,
              deliveredAt,
            },
          })
        return tx.usageMonthly.upsert({
          where: { period_phoneNumberId: { period, phoneNumberId: phone.id } },
          create: {
            period,
            phoneNumberId: phone.id,
            producerId: phone.producerId,
            producerCodeId: phone.responsibleProducerCodeId,
            openaiCalls: 1,
            openaiCachedInputTokens: cached,
            openaiInputTokens: input.inputTokens,
            openaiOutputTokens: input.outputTokens,
            openaiCostUsd: cost,
            totalCostUsd: cost,
          },
          update: {
            openaiCalls: { increment: 1 },
            openaiCachedInputTokens: { increment: cached },
            openaiInputTokens: { increment: input.inputTokens },
            openaiOutputTokens: { increment: input.outputTokens },
            openaiCostUsd: { increment: cost },
            totalCostUsd: { increment: cost },
          },
          select: {
            id: true,
            openaiCostUsd: true,
            openaiInputTokens: true,
            openaiOutputTokens: true,
            openaiCalls: true,
            metaMessages: true,
          },
        })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { overBudget: false }
      throw error
    }

    await this.refreshBilled(phone, row.id, row, period)
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.openaiCostUsd)) : { overBudget: false }
  }

  async recordMeta(input: RecordMetaInput): Promise<{ overBudget: boolean }> {
    const phone = await this.resolvePhone(input.metaPhoneNumberId)
    if (!phone) {
      this.logger.warn(`recordMeta: unknown phoneNumberId ${input.metaPhoneNumberId}`)
      return { overBudget: false }
    }

    const deliveredAt = new Date(input.timestamp * 1000)
    if (!Number.isFinite(deliveredAt.getTime())) throw new BadRequestException('Timestamp inválido')
    const period = currentPeriod(deliveredAt)
    let cost = 0
    if (input.billable) {
      try {
        cost = metaMessageRate(input.category, input.recipient, this.metaMarket)
      } catch (error) {
        throw new BadRequestException((error as Error).message)
      }
    }
    // Meta's billable flag accounts for the 1,000 free service messages and
    // free entry-point windows for provider cost only. Commercial pricing counts all messages.
    let row: MonthlyBillableUsage & { id: number; openaiCostUsd: unknown }
    try {
      row = await this.prisma.$transaction(async tx => {
        await tx.usageEvent.create({
          data: {
            provider: 'meta',
            phoneNumberId: phone.id,
            eventId: `meta:${input.messageId}`,
            period,
            category: input.category,
            billable: input.billable,
            costUsd: cost,
            deliveredAt,
          },
        })
        return tx.usageMonthly.upsert({
          where: { period_phoneNumberId: { period, phoneNumberId: phone.id } },
          create: {
            period,
            phoneNumberId: phone.id,
            producerId: phone.producerId,
            producerCodeId: phone.responsibleProducerCodeId,
            metaMessages: 1,
            metaBillableMessages: input.billable ? 1 : 0,
            metaCostUsd: cost,
            totalCostUsd: cost,
          },
          update: {
            metaMessages: { increment: 1 },
            metaBillableMessages: { increment: input.billable ? 1 : 0 },
            metaCostUsd: { increment: cost },
            totalCostUsd: { increment: cost },
          },
          select: {
            id: true,
            openaiCostUsd: true,
            openaiInputTokens: true,
            openaiOutputTokens: true,
            openaiCalls: true,
            metaMessages: true,
          },
        })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { overBudget: false }
      throw error
    }
    const bill = await this.refreshBilled(phone, row.id, row, period)
    if (bill && period === currentPeriod()) await this.followLimit(phone, bill)
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.openaiCostUsd)) : { overBudget: false }
  }

  /**
   * Keeps the number's plan in step with the running month. When the messages
   * pass its plan it moves to the plan that covers them and stays there (the
   * SuperAdmin can lower it again), and the office hears about it; past the
   * largest plan it hears once, on the first message over. A trial that ended
   * with the month gives way to the smallest paid plan, silently.
   */
  /**
   * At the plan's limit the number's assistant pauses (the bot context reads it) and the office is told: the
   * SuperAdmins and the admins of the number's code, in Asuntos pendientes and by mail. Nothing moves it to a bigger
   * plan but someone choosing to (BillingService.resolveLimit); otherwise it answers again next month.
   */
  private async followLimit(phone: PhoneForBilling, bill: MonthlyBill): Promise<void> {
    try {
      // The stored plan no longer holds (a trial past its month, a retired plan): back to the default.
      if (phone.planId != null && bill.assignedPlan?.id !== phone.planId && bill.assignedPlan?.id != null) {
        await this.prisma.phoneNumber.updateMany({
          where: { id: phone.id, planId: phone.planId },
          data: { planId: null },
        })
      }
      const period = currentPeriod()
      if (!bill.limitReached || pausedIn(phone.planPausedAt, period)) return
      // Only the first message at the limit pauses it: a concurrent one finds it already paused this month.
      const paused = await this.prisma.phoneNumber.updateMany({
        where: { id: phone.id, OR: [{ planPausedAt: null }, { planPausedAt: { lt: periodStart(period) } }] },
        data: { planPausedAt: new Date(), planPauseConfirmedAt: null },
      })
      if (paused.count === 0) return
      await this.announceLimit(phone, bill, period)
    } catch (err) {
      // Billing must never break usage tracking.
      this.logger.warn(`followLimit failed for phone ${phone.id}: ${err instanceof Error ? err.message : err}`)
    }
  }

  private async announceLimit(phone: PhoneForBilling, bill: MonthlyBill, period: string): Promise<void> {
    const next = this.nextPlanAfter(bill.plan, await this.catalog())
    const resumes = periodStart(nextPeriod(period)).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      timeZone: ARGENTINA_TZ,
    })
    const title = `El asistente del ${phone.number} está en pausa`
    const body =
      `Este mes llegó a los ${int(bill.plan.includedMessages)} mensajes de su plan ${bill.plan.name}, así que el ` +
      `asistente dejó de responder. Los mensajes se siguen guardando y la oficina puede contestar desde el panel. ` +
      (next
        ? `Para que vuelva a responder, elegí en Inicio o en Facturación pasar a ${next.name} ` +
          `(${int(next.messages)} mensajes, USD ${next.priceUsd.toLocaleString('es-AR')} por mes). `
        : '') +
      `Si no, vuelve a responder solo el ${resumes}.`
    await this.prisma.notification.create({
      data: {
        producerId: phone.producerId,
        producerCodeId: phone.responsibleProducerCodeId,
        phoneNumberId: phone.phoneNumberId,
        category: 'other',
        type: 'plan',
        refId: phone.id,
        title,
        body,
      },
    })
    const recipients = await this.prisma.user.findMany({
      where: {
        producerId: phone.producerId,
        deletedAt: null,
        OR: [
          { role: 'SUPERADMIN' },
          ...(phone.responsibleProducerCodeId != null
            ? [{ role: 'ADMIN' as const, producerCodes: { some: { producerCodeId: phone.responsibleProducerCodeId } } }]
            : []),
        ],
      },
      select: { email: true },
    })
    await this.mail.sendAlert({ to: recipients.map(u => u.email), subject: title, text: body })
  }

  private async refreshBilled(
    phone: PhoneForBilling,
    rowId: number,
    usage: MonthlyBillableUsage,
    period: string,
  ): Promise<MonthlyBill | null> {
    try {
      const [starts, catalog] = await Promise.all([this.serviceStarts([phone.id]), this.catalog()])
      const bill = this.billFor(
        {
          isActive: phone.isActive,
          serviceStartedAt: starts.get(phone.id) ?? null,
          planId: phone.planId,
          extraBlocks: acceptedBlocks(phone, period),
        },
        usage,
        catalog,
        period,
      )
      await this.prisma.usageMonthly.update({
        where: { id: rowId },
        data: { billedUsd: bill.billedUsd },
      })
      return bill
    } catch (err) {
      // Billing must never break usage tracking.
      this.logger.warn(`refreshBilled failed for row ${rowId}: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }

  /** Stamps budgetExceededAt once the running month's OpenAI spend reaches the budget. */
  private async applyBudget(
    phone: { id: number; monthlyBudgetUsd: unknown; budgetExceededAt: Date | null },
    openaiCost: number,
  ): Promise<{ overBudget: boolean }> {
    const budget = phone.monthlyBudgetUsd != null ? Number(phone.monthlyBudgetUsd) : this.defaultBudget
    const overBudget = openaiCost >= budget
    if (overBudget && !phone.budgetExceededAt) {
      await this.prisma.phoneNumber.update({ where: { id: phone.id }, data: { budgetExceededAt: new Date() } })
      this.logger.warn(`PhoneNumber ${phone.id} exceeded its OpenAI budget (USD ${openaiCost.toFixed(2)} ≥ ${budget})`)
    }
    return { overBudget }
  }

  /** True when the number's OpenAI spend is still under its monthly budget (LLM allowed). */
  async isLlmEnabled(metaPhoneNumberId: string): Promise<boolean> {
    const phone = await this.resolvePhone(metaPhoneNumberId)
    if (!phone) return true
    const budget = phone.monthlyBudgetUsd != null ? Number(phone.monthlyBudgetUsd) : this.defaultBudget
    const row = await this.prisma.usageMonthly.findUnique({
      where: { period_phoneNumberId: { period: currentPeriod(), phoneNumberId: phone.id } },
      select: { openaiCostUsd: true },
    })
    return Number(row?.openaiCostUsd ?? 0) < budget
  }

  /** Admin cost report, scoped to the codes the user can access. */
  async getSummary(producerId: number, codeIds: number[], period: string = currentPeriod()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
    const rows = await this.prisma.usageMonthly.findMany({
      where: {
        producerId,
        period,
        OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }],
      },
      select: {
        period: true,
        openaiCalls: true,
        metaMessages: true,
        metaBillableMessages: true,
        openaiCachedInputTokens: true,
        openaiInputTokens: true,
        openaiOutputTokens: true,
        openaiCostUsd: true,
        metaConversations: true,
        metaCostUsd: true,
        totalCostUsd: true,
        billedUsd: true,
        phoneNumber: {
          select: {
            id: true,
            number: true,
            phoneNumberId: true,
            isActive: true,
            monthlyBudgetUsd: true,
            budgetExceededAt: true,
            planId: true,
            extraBlocks: true,
            extraBlocksPeriod: true,
          },
        },
        producerCode: { select: { id: true, code: true, holderName: true } },
      },
      orderBy: { totalCostUsd: 'desc' },
    })

    // Recompute the plan from activity rather than trusting the stored billedUsd.
    const [starts, catalog] = await Promise.all([this.serviceStarts(rows.map(r => r.phoneNumber.id)), this.catalog()])
    const priced = rows.map(r => {
      const bill = this.billFor(
        {
          isActive: r.phoneNumber.isActive,
          serviceStartedAt: starts.get(r.phoneNumber.id) ?? null,
          planId: r.phoneNumber.planId,
          extraBlocks: acceptedBlocks(r.phoneNumber, period),
        },
        r,
        catalog,
        period,
      )
      return {
        ...r,
        messages: bill.messages,
        plan: bill.plan,
        prorated: bill.prorated,
        billedUsd: bill.billedUsd,
        // OpenAI is prepaid: the profit is what we bill minus what Meta charges.
        marginUsd: round2(bill.billedUsd - Number(r.metaCostUsd)),
      }
    })

    const totals = priced.reduce(
      (acc, r) => {
        acc.openaiCostUsd += Number(r.openaiCostUsd)
        acc.metaCostUsd += Number(r.metaCostUsd)
        acc.totalCostUsd += Number(r.totalCostUsd)
        acc.billedUsd += r.billedUsd
        acc.marginUsd += r.marginUsd
        return acc
      },
      { openaiCostUsd: 0, metaCostUsd: 0, totalCostUsd: 0, billedUsd: 0, marginUsd: 0 },
    )

    return { period, rows: priced, totals }
  }
}
