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
  if (period !== currentPeriod()) return 1 // a past (or future) month is not partial

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  // Include the fraction of today already gone, so the number also moves within
  // the day instead of jumping once at midnight.
  const elapsedDays = now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / (24 * 60)

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
  private readonly metaMarket: string
  private readonly defaultBudget: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.priceInPer1M = Number(config.get('OPENAI_PRICE_IN_PER_1M') ?? 0.2)
    this.priceOutPer1M = Number(config.get('OPENAI_PRICE_OUT_PER_1M') ?? 1.2)
    this.priceCachedPer1M = Number(config.get('OPENAI_PRICE_CACHED_PER_1M') ?? 0.02)
    this.metaMarket = config.get('META_DEFAULT_MARKET') ?? 'Argentina'
    this.defaultBudget = Number(config.get('DEFAULT_MONTHLY_BUDGET_USD') ?? 20)
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

  /** All reports use actual accumulated monthly usage × 3. */
  priceFor(_phone: unknown, cost: number): number {
    return Math.round((Number.isFinite(cost) && cost > 0 ? cost : 0) * 3 * 100) / 100
  }

  elapsedFractionOf(period: string): number {
    return periodElapsedFraction(period)
  }

  async recordOpenAI(input: RecordOpenAiInput): Promise<{ overBudget: boolean }> {
    const phone = await this.resolvePhone(input.metaPhoneNumberId)
    if (!phone) {
      this.logger.warn(`recordOpenAI: unknown phoneNumberId ${input.metaPhoneNumberId}`)
      return { overBudget: false }
    }

    const cached = Math.min(input.inputTokens, Math.max(0, input.cachedInputTokens ?? 0))
    const model = input.model ?? 'gpt-5.6-luna'
    const rates = model.startsWith('gpt-6-luna')
      ? { input: 0.1, cached: 0.01, output: 0.5 }
      : model.startsWith('gpt-5.6-luna')
        ? { input: this.priceInPer1M, cached: this.priceCachedPer1M, output: this.priceOutPer1M }
        : null
    if (!rates) throw new BadRequestException(`Tarifa no configurada para el modelo ${model}`)
    const longContext = input.inputTokens > 272_000
    const cost =
      ((input.inputTokens - cached) * rates.input * (longContext ? 2 : 1) +
        cached * rates.cached * (longContext ? 2 : 1) +
        input.outputTokens * rates.output * (longContext ? 1.5 : 1)) /
      1_000_000
    const deliveredAt = input.timestamp != null ? new Date(input.timestamp * 1000) : new Date()
    const period = currentPeriod(deliveredAt)

    let row: { id: number; totalCostUsd: unknown }
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
          select: { id: true, totalCostUsd: true },
        })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { overBudget: false }
      throw error
    }

    await this.refreshBilled(phone, row.id, Number(row.totalCostUsd))
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
    // free entry-point windows. Do not charge those again locally.
    let row: { id: number; totalCostUsd: unknown }
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
          select: { id: true, totalCostUsd: true },
        })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { overBudget: false }
      throw error
    }
    await this.refreshBilled(phone, row.id, Number(row.totalCostUsd))
    return period === currentPeriod() ? this.applyBudget(phone, Number(row.totalCostUsd)) : { overBudget: false }
  }

  /** Recomputes the invoiced amount for a period row after the cost changed. */
  private async refreshBilled(
    phone: { id: number; monthlyBasePriceUsd: unknown; monthlyMaxPriceUsd: unknown },
    rowId: number,
    cost: number,
  ): Promise<void> {
    const billed = this.priceFor(phone, cost)

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

    // Recompute from stored provider cost so old floor/ceiling prices are never
    // returned. accruedUsd stays as a compatibility alias for monthly usage.
    const elapsed = periodElapsedFraction(period)

    const priced = rows.map(r => {
      const billed = r.phoneNumber ? this.priceFor(r.phoneNumber, Number(r.totalCostUsd)) : Number(r.billedUsd)
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
