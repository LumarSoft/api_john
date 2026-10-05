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

/** Current month key in local time, e.g. "2026-06". */
export function currentPeriod(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`
}

/**
 * How much of a period has already elapsed, from 0 to 1.
 *
 * A closed month is 1 (fully accrued). The running month is the share of days
 * already gone, so the first day sits near zero and the figure climbs daily
 * until it reaches the full monthly charge on the last day.
 */
function periodElapsedFraction(period: string, now: Date = new Date()): number {
  if (period !== currentPeriod(now)) return 1
  const [year, month] = period.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find(p => p.type === type)!.value)
  const elapsedDays = part('day') - 1 + (part('hour') * 60 + part('minute')) / (24 * 60)
  return Math.min(1, Math.max(0, elapsedDays / daysInMonth))
}

/**
 * Tracks per-number monthly cost (OpenAI requests/tokens + delivered Meta messages) and
 * enforces a per-number budget cap. When a number crosses its cap we stamp
 * PhoneNumber.budgetExceededAt; the bot then disables the paid LLM (deterministic
 * flows keep working at zero token cost) until the next month resets the total.
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
  readonly commercialPricing: {
    minimumUsd: number
    maximumUsd: number
    tokenRatePer1000: number
    metaMessageRateUsd: number
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
      minimumUsd: Number(config.get('COMMERCIAL_MONTHLY_MIN_USD') ?? 50),
      maximumUsd: Number(config.get('COMMERCIAL_MONTHLY_MAX_USD') ?? 100),
      tokenRatePer1000: Number(config.get('COMMERCIAL_TOKEN_PRICE_PER_1000') ?? 0.0375),
      metaMessageRateUsd: Number(config.get('COMMERCIAL_META_MESSAGE_PRICE_USD') ?? 0.078),
    }
    if (
      Object.values(this.commercialPricing).some(value => !Number.isFinite(value) || value <= 0) ||
      this.commercialPricing.minimumUsd > this.commercialPricing.maximumUsd
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
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
        monthlyBasePriceUsd: true,
        monthlyMaxPriceUsd: true,
      },
    })
  }

  /** Commercial service tariff; provider costs remain separate for margin/budgets. */
  priceFor(_phone: unknown, usage: MonthlyBillableUsage | undefined, period = currentPeriod()): number {
    const tokens = (usage?.openaiInputTokens ?? 0) + (usage?.openaiOutputTokens ?? 0)
    const messages = usage?.metaMessages ?? 0
    if (tokens === 0 && messages === 0 && !usage?.openaiCalls) return 0
    const pricing = this.commercialPricing
    const consumed = (tokens / 1000) * pricing.tokenRatePer1000 + messages * pricing.metaMessageRateUsd
    const minimum = pricing.minimumUsd * periodElapsedFraction(period)
    return Math.round(Math.min(pricing.maximumUsd, Math.max(minimum, consumed)) * 100) / 100
  }

  elapsedFractionOf(period: string): number {
    return periodElapsedFraction(period)
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

    let row: MonthlyBillableUsage & { id: number; totalCostUsd: unknown }
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
            totalCostUsd: true,
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
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.totalCostUsd)) : { overBudget: false }
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
    let row: MonthlyBillableUsage & { id: number; totalCostUsd: unknown }
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
            totalCostUsd: true,
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
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.totalCostUsd)) : { overBudget: false }
  }

  /** Recomputes the invoiced amount for a period row after the cost changed. */
  private async refreshBilled(
    phone: { id: number; monthlyBasePriceUsd: unknown; monthlyMaxPriceUsd: unknown },
    rowId: number,
    usage: MonthlyBillableUsage,
    period: string,
  ): Promise<void> {
    const billed = this.priceFor(phone, usage, period)

    try {
      await this.prisma.usageMonthly.update({
        where: { id: rowId },
        data: { billedUsd: billed },
      })
    } catch (err) {
      // Billing must never break usage tracking.
      this.logger.warn(`refreshBilled failed for row ${rowId}: ${err instanceof Error ? err.message : err}`)
    }
  }

  /** Stamps/clears budgetExceededAt based on the running month total. */
  private async applyBudget(
    phone: { id: number; monthlyBudgetUsd: unknown; budgetExceededAt: Date | null },
    total: number,
  ): Promise<{ overBudget: boolean }> {
    const budget = phone.monthlyBudgetUsd != null ? Number(phone.monthlyBudgetUsd) : this.defaultBudget
    const overBudget = total >= budget
    if (overBudget && !phone.budgetExceededAt) {
      await this.prisma.phoneNumber.update({ where: { id: phone.id }, data: { budgetExceededAt: new Date() } })
      this.logger.warn(`PhoneNumber ${phone.id} exceeded budget (USD ${total.toFixed(2)} ≥ ${budget})`)
    }
    return { overBudget }
  }

  /** True when the number is still under its monthly budget (LLM allowed). */
  async isLlmEnabled(metaPhoneNumberId: string): Promise<boolean> {
    const phone = await this.resolvePhone(metaPhoneNumberId)
    if (!phone) return true
    const budget = phone.monthlyBudgetUsd != null ? Number(phone.monthlyBudgetUsd) : this.defaultBudget
    const row = await this.prisma.usageMonthly.findUnique({
      where: { period_phoneNumberId: { period: currentPeriod(), phoneNumberId: phone.id } },
      select: { totalCostUsd: true },
    })
    return Number(row?.totalCostUsd ?? 0) < budget
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
            monthlyBudgetUsd: true,
            budgetExceededAt: true,
            monthlyBasePriceUsd: true,
            monthlyMaxPriceUsd: true,
          },
        },
        producerCode: { select: { id: true, code: true, holderName: true } },
      },
      orderBy: { totalCostUsd: 'desc' },
    })

    // Recompute commercial pricing from activity. accruedUsd is a compatibility alias.
    const elapsed = periodElapsedFraction(period)

    const priced = rows.map(r => {
      const billed = this.priceFor(r.phoneNumber, r, period)
      const accrued = billed
      return {
        ...r,
        billedUsd: billed,
        accruedUsd: accrued,
        marginUsd: billed - Number(r.totalCostUsd),
      }
    })

    const totals = priced.reduce(
      (acc, r) => {
        acc.openaiCostUsd += Number(r.openaiCostUsd)
        acc.metaCostUsd += Number(r.metaCostUsd)
        acc.totalCostUsd += Number(r.totalCostUsd)
        acc.billedUsd += r.billedUsd
        acc.accruedUsd += r.accruedUsd
        acc.marginUsd += r.marginUsd
        return acc
      },
      { openaiCostUsd: 0, metaCostUsd: 0, totalCostUsd: 0, billedUsd: 0, accruedUsd: 0, marginUsd: 0 },
    )

    return { period, elapsedFraction: Math.round(elapsed * 1000) / 1000, rows: priced, totals }
  }
}
