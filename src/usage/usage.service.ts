import { metaMessageRate } from './meta-rates'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'

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
  metaMessages?: number
}

/** A number as billing needs it: whether it is switched on and when it went live. */
export interface BillablePhone {
  isActive: boolean
  /** First message the number ever recorded; null = never in service. */
  serviceStartedAt: Date | null
}

export interface TokenPlan {
  /** 1,000-token blocks billed: 1 = Inicial, 2 = Estándar… */
  blocks: number
  name: string
  includedTokens: number
  priceUsd: number
}

export interface MonthlyBill {
  /** Messages the platform sent: one token each. */
  tokens: number
  plan: TokenPlan
  billedUsd: number
  /** True when the minimum plan was prorated for the first month of service. */
  prorated: boolean
}

const ARGENTINA_TZ = 'America/Argentina/Cordoba'

/** Plan names of the commercial proposal; beyond the last, blocks keep adding to it. */
const PLAN_NAMES = ['Inicial', 'Estándar', 'Profesional', 'Avanzado']

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
function periodStart(period: string): Date {
  return new Date(`${period}-01T00:00:00-03:00`)
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

/**
 * Tracks per-number monthly cost (OpenAI requests/tokens + delivered Meta messages),
 * prices the commercial token plans, and enforces a per-number budget cap on the
 * OpenAI spend. When a number crosses its cap we stamp PhoneNumber.budgetExceededAt;
 * the bot then disables the paid LLM (deterministic flows keep working at zero token
 * cost) until the next month resets the total. Meta's cost is not capped: every
 * message is a token the client pays for, so a busy month moves to a bigger plan.
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
  /** Token plans: every block of tokens (messages sent) costs the same. */
  readonly commercialPricing: {
    blockTokens: number
    blockPriceUsd: number
  }

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.priceInPer1M = Number(config.get('OPENAI_PRICE_IN_PER_1M') ?? 0.2)
    this.priceOutPer1M = Number(config.get('OPENAI_PRICE_OUT_PER_1M') ?? 1.2)
    this.priceCachedPer1M = Number(config.get('OPENAI_PRICE_CACHED_PER_1M') ?? 0.02)
    this.transcribePricePerMinute = Number(config.get('OPENAI_TRANSCRIBE_PRICE_PER_MINUTE') ?? 0.0045)
    this.metaMarket = config.get('META_DEFAULT_MARKET') ?? 'Argentina'
    this.defaultBudget = Number(config.get('DEFAULT_MONTHLY_BUDGET_USD') ?? 20)
    this.commercialPricing = {
      blockTokens: Number(config.get('COMMERCIAL_TOKEN_BLOCK_SIZE') ?? 1000),
      blockPriceUsd: Number(config.get('COMMERCIAL_TOKEN_BLOCK_PRICE_USD') ?? 50),
    }
    if (
      Object.values(this.commercialPricing).some(value => !Number.isFinite(value) || value <= 0) ||
      !Number.isInteger(this.commercialPricing.blockTokens)
    )
      throw new Error('Invalid commercial billing configuration')
  }

  private async resolvePhone(metaPhoneNumberId: string) {
    return this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId: metaPhoneNumberId, deletedAt: null },
      select: {
        id: true,
        producerId: true,
        responsibleProducerCodeId: true,
        isActive: true,
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
      },
    })
  }

  /** The smallest plan that covers the tokens; Inicial even for a quiet month. */
  planFor(tokens: number): TokenPlan {
    const { blockTokens, blockPriceUsd } = this.commercialPricing
    const blocks = Math.max(1, Math.ceil(tokens / blockTokens))
    const last = PLAN_NAMES.length
    const name =
      blocks <= last
        ? PLAN_NAMES[blocks - 1]
        : `${PLAN_NAMES[last - 1]} + ${((blocks - last) * blockTokens).toLocaleString('es-AR')}`
    return { blocks, name, includedTokens: blocks * blockTokens, priceUsd: blocks * blockPriceUsd }
  }

  /**
   * What the client is invoiced for a number in a month (billed in arrears).
   *
   * One token per message sent. The plan is picked again every month from that
   * month's tokens, so a busy month moves up a plan and a quiet one comes back
   * down. An active number pays at least Inicial; in its first month of service
   * that minimum is prorated from the day it went live. A number that never went
   * live, or that was switched off and sent nothing, is not billed.
   */
  billFor(phone: BillablePhone, usage: MonthlyBillableUsage | undefined, period = currentPeriod()): MonthlyBill {
    const tokens = usage?.metaMessages ?? 0
    const plan = this.planFor(tokens)
    const startPeriod = phone.serviceStartedAt ? currentPeriod(phone.serviceStartedAt) : null
    if (!startPeriod || startPeriod > period || (!phone.isActive && tokens === 0))
      return { tokens, plan, billedUsd: 0, prorated: false }
    const share = plan.blocks === 1 && startPeriod === period ? serviceShareOfMonth(period, phone.serviceStartedAt!) : 1
    return { tokens, plan, billedUsd: Math.round(plan.priceUsd * share * 100) / 100, prorated: share < 1 }
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
    await this.refreshBilled(phone, row.id, row, period)
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.openaiCostUsd)) : { overBudget: false }
  }

  /** Recomputes the invoiced amount for a period row after its activity changed. */
  private async refreshBilled(
    phone: { id: number; isActive: boolean },
    rowId: number,
    usage: MonthlyBillableUsage,
    period: string,
  ): Promise<void> {
    try {
      const serviceStartedAt = (await this.serviceStarts([phone.id])).get(phone.id) ?? null
      const { billedUsd } = this.billFor({ isActive: phone.isActive, serviceStartedAt }, usage, period)
      await this.prisma.usageMonthly.update({
        where: { id: rowId },
        data: { billedUsd },
      })
    } catch (err) {
      // Billing must never break usage tracking.
      this.logger.warn(`refreshBilled failed for row ${rowId}: ${err instanceof Error ? err.message : err}`)
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
          },
        },
        producerCode: { select: { id: true, code: true, holderName: true } },
      },
      orderBy: { totalCostUsd: 'desc' },
    })

    // Recompute the commercial plan from activity rather than trusting the stored billedUsd.
    const starts = await this.serviceStarts(rows.map(r => r.phoneNumber.id))
    const priced = rows.map(r => {
      const bill = this.billFor(
        { isActive: r.phoneNumber.isActive, serviceStartedAt: starts.get(r.phoneNumber.id) ?? null },
        r,
        period,
      )
      return {
        ...r,
        tokens: bill.tokens,
        plan: bill.plan,
        prorated: bill.prorated,
        billedUsd: bill.billedUsd,
        marginUsd: bill.billedUsd - Number(r.totalCostUsd),
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
