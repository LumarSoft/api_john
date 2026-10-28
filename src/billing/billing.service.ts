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
  _count: { select: { phoneNumbers: { where: { deletedAt: null } } } },
} as const

/**
 * "Facturación" in the panel: the plans an organization offers its numbers,
 * which plan each number is on, and how far into it the running month is.
 *
 * The price per token is the platform's (COMMERCIAL_TOKEN_PRICE_USD); the
 * SuperAdmin only chooses the sizes. Admins see the numbers of their codes
 * and may move them to another plan; a month that goes past the number's plan
 * is billed on the plan that covers it (UsageService.planFor).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly scope: ScopeService,
  ) {}

  // ─── Catalog ───────────────────────────────────────────

  async listPlans(producerId: number, includeInactive: boolean) {
    const plans = await this.prisma.tokenPlan.findMany({
      where: { producerId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { tokens: 'asc' }, { id: 'asc' }],
      select: PLAN_SELECT,
    })
    return { unitPriceUsd: this.usage.commercialPricing.unitPriceUsd, plans: plans.map(toPlan) }
  }

  async createPlan(producerId: number, dto: CreateTokenPlanDto) {
    const plan = await this.prisma.tokenPlan.create({
      data: {
        producerId,
        name: dto.name.trim(),
        tokens: dto.tokens,
        priceUsd: this.usage.priceOf(dto.tokens),
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(producerId)),
      },
      select: PLAN_SELECT,
    })
    return toPlan(plan)
  }

  async updatePlan(producerId: number, id: number, dto: UpdateTokenPlanDto) {
    await this.findPlan(producerId, id)
    const plan = await this.prisma.tokenPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        // The price always follows the size: the unit price is not the organization's to change.
        ...(dto.tokens !== undefined ? { tokens: dto.tokens, priceUsd: this.usage.priceOf(dto.tokens) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: PLAN_SELECT,
    })
    return toPlan(plan)
  }

  /** Retires a plan; the numbers on it fall back to the organization's smallest. */
  async removePlan(producerId: number, id: number) {
    await this.findPlan(producerId, id)
    await this.prisma.$transaction([
      this.prisma.phoneNumber.updateMany({ where: { tokenPlanId: id }, data: { tokenPlanId: null } }),
      this.prisma.tokenPlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    ])
    return { ok: true }
  }

  // ─── Numbers ───────────────────────────────────────────

  /** The running month of every number the user may see: plan, tokens used and what it adds up to. */
  async overview(user: ScopeUser, period = currentPeriod()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
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
          tokenPlan: { select: { id: true, name: true, tokens: true, priceUsd: true } },
          usageMonthly: { where: { period }, select: { metaMessages: true, updatedAt: true } },
        },
      }),
      this.usage.catalogFor(user.producerId),
    ])
    const starts = await this.usage.serviceStarts(numbers.map(n => n.id))

    const rows = numbers.map(n => {
      const usage = n.usageMonthly[0]
      const assigned: CatalogPlan | null = n.tokenPlan
        ? { ...n.tokenPlan, priceUsd: Number(n.tokenPlan.priceUsd) }
        : null
      const bill = this.usage.billFor(
        {
          isActive: n.isActive,
          serviceStartedAt: starts.get(n.id) ?? null,
          trialTokens: n.trialTokens,
          plan: assigned,
          catalog,
        },
        usage,
        period,
      )
      // The bar: the number's own plan (or the smallest), plus the trial of a first month.
      const ownPlan = assigned ?? catalog[0] ?? null
      const includedTokens = (bill.plan.trial ? 0 : (ownPlan?.tokens ?? bill.plan.includedTokens)) + bill.trialTokens
      const percentUsed = includedTokens > 0 ? Math.round((bill.tokens / includedTokens) * 1000) / 10 : 0
      return {
        id: n.id,
        number: n.number,
        isActive: n.isActive,
        responsibleCode: n.responsibleProducerCode,
        plan: ownPlan,
        trialTokens: bill.trialTokens,
        tokensUsed: bill.tokens,
        includedTokens,
        remainingTokens: Math.max(0, includedTokens - bill.tokens),
        percentUsed,
        exceeded: bill.tokens > includedTokens,
        // What the month is billed on right now: the plan itself, or the one that covers the excess.
        billedPlan: bill.plan,
        estimatedUsd: bill.billedUsd,
        prorated: bill.prorated,
        updatedAt: usage?.updatedAt?.toISOString() ?? null,
      }
    })

    return {
      period,
      unitPriceUsd: this.usage.commercialPricing.unitPriceUsd,
      blockTokens: this.usage.commercialPricing.blockTokens,
      trialTokens: this.usage.commercialPricing.trialTokens,
      plans: catalog,
      numbers: rows,
      totalEstimatedUsd: Math.round(rows.reduce((sum, r) => sum + r.estimatedUsd, 0) * 100) / 100,
    }
  }

  /** Moves a number to another plan of the catalog (null = the smallest); takes effect this month. */
  async setNumberPlan(user: ScopeUser, numberId: number, planId: number | null | undefined) {
    const number = await this.prisma.phoneNumber.findFirst({
      where: { id: numberId, producerId: user.producerId, deletedAt: null, ...(await this.numberScope(user)) },
      select: { id: true },
    })
    if (!number) throw new NotFoundException(`Phone number ${numberId} not found`)
    if (planId != null) {
      const plan = await this.prisma.tokenPlan.findFirst({
        where: { id: planId, producerId: user.producerId, deletedAt: null, isActive: true },
        select: { id: true },
      })
      if (!plan) throw new BadRequestException('Ese plan no está disponible.')
    }
    await this.prisma.phoneNumber.update({ where: { id: numberId }, data: { tokenPlanId: planId ?? null } })
    return { id: numberId, planId: planId ?? null }
  }

  // ─── Helpers ───────────────────────────────────────────

  /** An admin sees the numbers billed to one of their codes; the SuperAdmin and the owner, every number. */
  private async numberScope(user: ScopeUser) {
    if (user.role === Role.SUPERADMIN || user.role === Role.OWNER) return {}
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    return { responsibleProducerCodeId: { in: codeIds } }
  }

  private async findPlan(producerId: number, id: number) {
    const plan = await this.prisma.tokenPlan.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true },
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
}

function toPlan(plan: {
  id: number
  name: string
  tokens: number
  priceUsd: unknown
  isActive: boolean
  sortOrder: number
  _count: { phoneNumbers: number }
}) {
  return {
    id: plan.id,
    name: plan.name,
    tokens: plan.tokens,
    priceUsd: Number(plan.priceUsd),
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    numbersOnPlan: plan._count.phoneNumbers,
  }
}
