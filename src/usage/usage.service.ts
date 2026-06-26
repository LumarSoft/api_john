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
      },
    })
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
      select: { totalCostUsd: true },
    })

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
      select: { totalCostUsd: true },
    })

    return this.applyBudget(phone, Number(row.totalCostUsd))
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
        phoneNumber: {
          select: { id: true, number: true, phoneNumberId: true, monthlyBudgetUsd: true, budgetExceededAt: true },
        },
        producerCode: { select: { id: true, code: true, holderName: true } },
      },
      orderBy: { totalCostUsd: 'desc' },
    })

    const totals = rows.reduce(
      (acc, r) => {
        acc.openaiCostUsd += Number(r.openaiCostUsd)
        acc.metaCostUsd += Number(r.metaCostUsd)
        acc.totalCostUsd += Number(r.totalCostUsd)
        return acc
      },
      { openaiCostUsd: 0, metaCostUsd: 0, totalCostUsd: 0 },
    )

    return { period, rows, totals }
  }
}
