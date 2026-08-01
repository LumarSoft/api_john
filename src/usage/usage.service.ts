import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'

export interface RecordOpenAiInput {
  /** Meta phone_number_id the LLM call was for. */
  metaPhoneNumberId: string
  model?: string
  inputTokens: number
  outputTokens: number
}

export interface RecordMetaInput {
  metaPhoneNumberId: string
  conversations?: number
  /** Exact cost from Meta's webhook pricing, if known. Falls back to the env rate. */
  costUsd?: number
}

/** Current month key in local time, e.g. "2026-06". */
function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Tracks per-number monthly cost (OpenAI tokens + Meta conversations) and
 * enforces a per-number budget cap. When a number crosses its cap we stamp
 * PhoneNumber.budgetExceededAt; the bot then disables the paid LLM (deterministic
 * flows keep working at zero token cost) until the next month resets the total.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  // gpt-4o-mini default pricing (USD per 1M tokens). Override via env.
  private readonly priceInPer1M: number
  private readonly priceOutPer1M: number
  private readonly metaPerConversation: number
  private readonly defaultBudget: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.priceInPer1M = Number(config.get('OPENAI_PRICE_IN_PER_1M') ?? 0.15)
    this.priceOutPer1M = Number(config.get('OPENAI_PRICE_OUT_PER_1M') ?? 0.6)
    this.metaPerConversation = Number(config.get('META_COST_PER_CONVERSATION_USD') ?? 0.05)
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

  /**
   * Amount invoiced to the client for a number in a month.
   *
   *   billed = LO + (HI − LO) · min(1, (cost / REF) ^ EXP)
   *
   * A price curve, not a measurement. It maps the measured cost onto the
   * commercial band [LO, HI]:
   *
   *   - it is monotonic, so a heavier month always invoices more than a lighter one
   *   - the exponent keeps small months near the floor and only lets the price
   *     climb as consumption approaches REF
   *   - being continuous over a 6-decimal cost, consecutive months land on
   *     different amounts on their own, without any synthetic variation
   *
   * Reference points with the defaults below:
   *
   *   cost  2 USD → 51.20      cost 20 USD → 57.36
   *   cost  5 USD → 51.80      cost 30 USD → 62.69
   *   cost 10 USD → 53.25      cost 40 USD → 69.00 (ceiling)
   *
   * Constants live here rather than in env because they are product decisions,
   * not deployment configuration. A number can still override the band through
   * PhoneNumber.monthlyBasePriceUsd / monthlyMaxPriceUsd.
   */
  /** Floor of the commercial band, in USD. */
  private static readonly PRICE_FLOOR = 51
  /** Ceiling of the commercial band, in USD. */
  private static readonly PRICE_CEILING = 69
  /**
   * Monthly cost at which the price sits at the middle of the band (60 USD).
   * Set it to the number's typical monthly cost — that centres the curve on the
   * range where the number actually lives, so the price has room to move both up
   * and down instead of resting against an edge.
   */
  private static readonly PRICE_HALFWAY_COST = 2

  private computeBilled(phone: { monthlyBasePriceUsd: unknown; monthlyMaxPriceUsd: unknown }, cost: number): number {
    const floor = phone.monthlyBasePriceUsd != null ? Number(phone.monthlyBasePriceUsd) : UsageService.PRICE_FLOOR
    const rawCeiling = phone.monthlyMaxPriceUsd != null ? Number(phone.monthlyMaxPriceUsd) : UsageService.PRICE_CEILING
    // A ceiling configured below the floor must not produce a price under the minimum.
    const ceiling = Math.max(floor, rawCeiling)

    const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0

    // Saturating curve: price = floor + (ceiling − floor) · (1 − 2^(−cost/HALF)).
    //
    // Chosen over a clamped multiplier because it never rests on either edge:
    // it approaches the ceiling asymptotically instead of hitting it, so a heavy
    // month still produces a distinct figure (68.44, 68.71, …) rather than the
    // same 69.00 every time. It is monotonic — a costlier month always invoices
    // more — and continuous over a 6-decimal cost, so two months only coincide
    // if their token and conversation counts coincide exactly.
    const progress = 1 - Math.pow(2, -safeCost / UsageService.PRICE_HALFWAY_COST)
    const price = floor + (ceiling - floor) * progress

    return Math.round(price * 100) / 100
  }

  async recordOpenAI(input: RecordOpenAiInput): Promise<{ overBudget: boolean }> {
    const phone = await this.resolvePhone(input.metaPhoneNumberId)
    if (!phone) {
      this.logger.warn(`recordOpenAI: unknown phoneNumberId ${input.metaPhoneNumberId}`)
      return { overBudget: false }
    }

    const cost =
      (input.inputTokens / 1_000_000) * this.priceInPer1M + (input.outputTokens / 1_000_000) * this.priceOutPer1M

    const row = await this.prisma.usageMonthly.upsert({
      where: { period_phoneNumberId: { period: currentPeriod(), phoneNumberId: phone.id } },
      create: {
        period: currentPeriod(),
        phoneNumberId: phone.id,
        producerId: phone.producerId,
        producerCodeId: phone.responsibleProducerCodeId,
        openaiInputTokens: input.inputTokens,
        openaiOutputTokens: input.outputTokens,
        openaiCostUsd: cost,
        totalCostUsd: cost,
      },
      update: {
        openaiInputTokens: { increment: input.inputTokens },
        openaiOutputTokens: { increment: input.outputTokens },
        openaiCostUsd: { increment: cost },
        totalCostUsd: { increment: cost },
      },
      select: { id: true, totalCostUsd: true },
    })

    await this.refreshBilled(phone, row.id, Number(row.totalCostUsd))
    return this.applyBudget(phone, Number(row.totalCostUsd))
  }

  async recordMeta(input: RecordMetaInput): Promise<{ overBudget: boolean }> {
    const phone = await this.resolvePhone(input.metaPhoneNumberId)
    if (!phone) {
      this.logger.warn(`recordMeta: unknown phoneNumberId ${input.metaPhoneNumberId}`)
      return { overBudget: false }
    }

    const conversations = input.conversations ?? 1
    const cost = input.costUsd ?? conversations * this.metaPerConversation

    const row = await this.prisma.usageMonthly.upsert({
      where: { period_phoneNumberId: { period: currentPeriod(), phoneNumberId: phone.id } },
      create: {
        period: currentPeriod(),
        phoneNumberId: phone.id,
        producerId: phone.producerId,
        producerCodeId: phone.responsibleProducerCodeId,
        metaConversations: conversations,
        metaCostUsd: cost,
        totalCostUsd: cost,
      },
      update: {
        metaConversations: { increment: conversations },
        metaCostUsd: { increment: cost },
        totalCostUsd: { increment: cost },
      },
      select: { id: true, totalCostUsd: true },
    })

    await this.refreshBilled(phone, row.id, Number(row.totalCostUsd))
    return this.applyBudget(phone, Number(row.totalCostUsd))
  }

  /** Recomputes the invoiced amount for a period row after the cost changed. */
  private async refreshBilled(
    phone: { id: number; monthlyBasePriceUsd: unknown; monthlyMaxPriceUsd: unknown },
    rowId: number,
    cost: number,
  ): Promise<void> {
    const billed = this.computeBilled(phone, cost)

    // The ceiling caps the invoice but not the cost: past a point the number is
    // served at a loss and nothing else would surface it.
    if (billed < cost) {
      this.logger.error(
        `PhoneNumber ${phone.id}: cost USD ${cost.toFixed(2)} exceeds the invoiced ` +
          `USD ${billed.toFixed(2)} — this number is losing money this month`,
      )
    }

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
    const rows = await this.prisma.usageMonthly.findMany({
      where: {
        producerId,
        period,
        OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }],
      },
      select: {
        period: true,
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

    // A row created before this feature (or never touched since) still shows a
    // stale billedUsd, so the invoiced amount is recomputed on read. Cheap, and
    // it keeps the report correct right after a price change.
    const priced = rows.map(r => {
      const billed = r.phoneNumber ? this.computeBilled(r.phoneNumber, Number(r.totalCostUsd)) : Number(r.billedUsd)
      return { ...r, billedUsd: billed, marginUsd: billed - Number(r.totalCostUsd) }
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
