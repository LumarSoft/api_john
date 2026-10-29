import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import { CatalogPlan, currentPeriod, UsageService } from '../usage/usage.service'
import { CreateTokenPlanDto, UpdateTokenPlanDto } from './dto/token-plan.dto'

const PLAN_SELECT = {
  id: true,
  name: true,
  tokens: true,
  priceUsd: true,
  isActive: true,
  sortOrder: true,
} as const

type PlanRow = {
  id: number
  name: string
  tokens: number
  priceUsd: unknown
  isActive: boolean
  sortOrder: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * "Facturación" in the panel: the plans of the organization's catalog and how
 * far into its plan each number is this month.
 *
 * Nobody assigns a plan to a number: each month it is placed on the smallest
 * plan that covers the tokens it sent (UsageService.planFor), and moves up as
 * it sends more. A plan costs the organization its tokens at the platform's
 * unit price (COMMERCIAL_TOKEN_PRICE_USD); the SuperAdmin chooses the sizes and
 * the price its productores pay, which is never below that cost — the cost is
 * shown next to every price so the organization never sells at a loss.
 * Admins (the productores) see the numbers of their codes, never the cost.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly scope: ScopeService,
  ) {}

  // ─── Catalog ───────────────────────────────────────────

  /** The catalog; the SuperAdmin also gets the retired plans and every plan's cost and margin. */
  async listPlans(producerId: number, forManager: boolean) {
    const plans = await this.prisma.tokenPlan.findMany({
      where: { producerId, deletedAt: null, ...(forManager ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { tokens: 'asc' }, { id: 'asc' }],
      select: PLAN_SELECT,
    })
    return {
      unitPriceUsd: this.usage.commercialPricing.unitPriceUsd,
      plans: plans.map(p => (forManager ? this.toPlan(p) : this.toOffer(p))),
    }
  }

  async createPlan(producerId: number, dto: CreateTokenPlanDto) {
    const plan = await this.prisma.tokenPlan.create({
      data: {
        producerId,
        name: dto.name.trim(),
        tokens: dto.tokens,
        priceUsd: this.priceFor(dto.tokens, dto.priceUsd),
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(producerId)),
      },
      select: PLAN_SELECT,
    })
    return this.toPlan(plan)
  }

  async updatePlan(producerId: number, id: number, dto: UpdateTokenPlanDto) {
    const current = await this.findPlan(producerId, id)
    const tokens = dto.tokens ?? current.tokens
    // A resized plan keeps its price unless that would now be below cost.
    const priceUsd =
      dto.priceUsd !== undefined || dto.tokens !== undefined
        ? this.priceFor(tokens, dto.priceUsd ?? Math.max(Number(current.priceUsd), this.usage.priceOf(tokens)))
        : undefined
    const plan = await this.prisma.tokenPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.tokens !== undefined ? { tokens: dto.tokens } : {}),
        ...(priceUsd !== undefined ? { priceUsd } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: PLAN_SELECT,
    })
    return this.toPlan(plan)
  }

  /** Retires a plan: from the next message on, numbers are placed on the remaining ones. */
  async removePlan(producerId: number, id: number) {
    await this.findPlan(producerId, id)
    await this.prisma.tokenPlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
    return { ok: true }
  }

  // ─── Numbers ───────────────────────────────────────────

  /**
   * The running month of every number the user may see: the plan its tokens
   * placed it on, how far into that plan it is (the consumption bar) and the
   * plan it moves to next. The SuperAdmin (and owner) also sees each plan's cost.
   */
  async overview(user: ScopeUser, period = currentPeriod()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
    const manager = this.isManager(user)
    const [numbers, catalog] = await Promise.all([
      this.prisma.phoneNumber.findMany({
        where: { producerId: user.producerId, deletedAt: null, ...(await this.numberScope(user)) },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          number: true,
          isActive: true,
          trialTokens: true,
          responsibleProducerCode: { select: { id: true, code: true, holderName: true } },
          usageMonthly: { where: { period }, select: { metaMessages: true, updatedAt: true } },
        },
      }),
      this.usage.catalogFor(user.producerId),
    ])
    const starts = await this.usage.serviceStarts(numbers.map(n => n.id))
    // The productores see prices, never what a plan costs the organization.
    const offer = (plan: CatalogPlan) =>
      manager ? plan : { id: plan.id, name: plan.name, tokens: plan.tokens, priceUsd: plan.priceUsd }

    const rows = numbers.map(n => {
      const usage = n.usageMonthly[0]
      const bill = this.usage.billFor(
        { isActive: n.isActive, serviceStartedAt: starts.get(n.id) ?? null, trialTokens: n.trialTokens, catalog },
        usage,
        period,
      )
      // The bar: the trial's free tokens while they last, then the plan the month is on (plus the trial).
      const includedTokens = bill.plan.trial ? bill.trialTokens : bill.plan.includedTokens + bill.trialTokens
      const percentUsed = includedTokens > 0 ? Math.round((bill.tokens / includedTokens) * 1000) / 10 : 0
      const { costUsd, ...plan } = bill.plan
      return {
        id: n.id,
        number: n.number,
        isActive: n.isActive,
        responsibleCode: n.responsibleProducerCode,
        // The plan this month's tokens placed the number on.
        plan: manager ? { ...plan, costUsd } : plan,
        trialTokens: bill.trialTokens,
        tokensUsed: bill.tokens,
        includedTokens,
        remainingTokens: Math.max(0, includedTokens - bill.tokens),
        percentUsed,
        // Where the number goes when it passes this plan.
        nextPlan: this.nextPlan(bill.plan, catalog),
        updatedAt: usage?.updatedAt?.toISOString() ?? null,
      }
    })

    return {
      period,
      unitPriceUsd: this.usage.commercialPricing.unitPriceUsd,
      blockTokens: this.usage.commercialPricing.blockTokens,
      trialTokens: this.usage.commercialPricing.trialTokens,
      plans: catalog.map(offer),
      numbers: rows,
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  /** The plan after `current`: the next of the catalog, or the next block past the largest. */
  private nextPlan(current: { trial: boolean; includedTokens: number }, catalog: CatalogPlan[]) {
    if (current.trial) {
      const first = catalog[0]
      return first ? { name: first.name, tokens: first.tokens } : null
    }
    const next = catalog.find(p => p.tokens > current.includedTokens)
    if (next) return { name: next.name, tokens: next.tokens }
    const largest = catalog.at(-1)
    if (!largest) return null
    const tokens = current.includedTokens + this.usage.commercialPricing.blockTokens
    return { name: `${largest.name} + ${(tokens - largest.tokens).toLocaleString('es-AR')}`, tokens }
  }

  /** The price the organization sells a plan for: what it asks, never below its cost; at cost when it asks nothing. */
  private priceFor(tokens: number, requested: number | undefined): number {
    const cost = this.usage.priceOf(tokens)
    if (requested === undefined) return cost
    const price = round2(requested)
    if (price < cost) {
      throw new BadRequestException(
        `El precio no puede ser menor que el costo del plan (USD ${cost.toLocaleString('es-AR')}).`,
      )
    }
    return price
  }

  private isManager(user: ScopeUser): boolean {
    return user.role === Role.SUPERADMIN || user.role === Role.OWNER
  }

  /** An admin sees the numbers billed to one of their codes; the SuperAdmin and the owner, every number. */
  private async numberScope(user: ScopeUser) {
    if (this.isManager(user)) return {}
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    return { responsibleProducerCodeId: { in: codeIds } }
  }

  private async findPlan(producerId: number, id: number) {
    const plan = await this.prisma.tokenPlan.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true, tokens: true, priceUsd: true },
    })
    if (!plan) throw new NotFoundException(`Token plan ${id} not found`)
    return plan
  }

  private async nextSortOrder(producerId: number): Promise<number> {
    const last = await this.prisma.tokenPlan.aggregate({
      where: { producerId, deletedAt: null },
      _max: { sortOrder: true },
    })
    return (last._max.sortOrder ?? -1) + 1
  }

  /** A plan with what it costs the organization and what it keeps: for the SuperAdmin. */
  private toPlan(plan: PlanRow) {
    const priceUsd = Number(plan.priceUsd)
    const costUsd = this.usage.priceOf(plan.tokens)
    return {
      id: plan.id,
      name: plan.name,
      tokens: plan.tokens,
      priceUsd,
      costUsd,
      marginUsd: round2(priceUsd - costUsd),
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    }
  }

  /** A plan as the productores see it: the price, never the organization's cost. */
  private toOffer(plan: PlanRow) {
    return {
      id: plan.id,
      name: plan.name,
      tokens: plan.tokens,
      priceUsd: Number(plan.priceUsd),
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    }
  }
}
