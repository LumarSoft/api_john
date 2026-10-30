import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import {
  acceptedBlocks,
  BilledPlan,
  CatalogPlan,
  currentPeriod,
  nextPeriod,
  pausedIn,
  UsageService,
} from '../usage/usage.service'
import { legacyTrialTokens, legacyUnitPriceUsd, withLegacyPlan } from '../usage/legacy-token-fields'
import { CreateMessagePlanDto, UpdateMessagePlanDto } from './dto/message-plan.dto'

const PLAN_SELECT = {
  id: true,
  name: true,
  messages: true,
  priceUsd: true,
  isTrial: true,
  isActive: true,
  sortOrder: true,
} as const

type PlanRow = {
  id: number
  name: string
  messages: number
  priceUsd: unknown
  isTrial: boolean
  isActive: boolean
  sortOrder: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** True when the number moved up a plan on its own during `period`. */
const movedUpIn = (at: Date | null | undefined, period: string): boolean => at != null && currentPeriod(at) === period

/**
 * "Facturación": the platform's message plans and each number's month.
 *
 * The OWNER (Lumar) is the only one who edits the catalog, the same for every
 * organization: a plan is a number of messages a month for a price (0 for the
 * trial). The SuperAdmin assigns a plan to each number of the organization. A
 * number never moves up on its own: at its plan's limit its assistant pauses
 * (UsageService.followLimit) until the office chooses the next plan or the month
 * ends (resolveLimit). The organization pays the whole plan; only the OWNER sees
 * the first month prorated, and what Meta and OpenAI really cost.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly scope: ScopeService,
  ) {}

  // ─── Catalog (owner) ───────────────────────────────────

  /** The whole catalog, plans switched off included, in the owner's order. */
  async listPlans() {
    const plans = await this.prisma.messagePlan.findMany({
      where: { producerId: null, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { messages: 'asc' }, { id: 'asc' }],
      select: PLAN_SELECT,
    })
    return { blockMessages: this.usage.commercialPricing.blockMessages, plans: plans.map(p => this.toPlan(p)) }
  }

  async createPlan(dto: CreateMessagePlanDto) {
    const isTrial = dto.isTrial ?? false
    this.assertTrialIsFree(isTrial, dto.priceUsd)
    if (isTrial) await this.assertNoOtherTrial(null)
    const plan = await this.prisma.messagePlan.create({
      data: {
        name: dto.name.trim(),
        messages: dto.messages,
        priceUsd: round2(dto.priceUsd),
        isTrial,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder()),
      },
      select: PLAN_SELECT,
    })
    return this.toPlan(plan)
  }

  async updatePlan(id: number, dto: UpdateMessagePlanDto) {
    const current = await this.findPlan(id)
    const isTrial = dto.isTrial ?? current.isTrial
    const priceUsd = dto.priceUsd ?? Number(current.priceUsd)
    const isActive = dto.isActive ?? current.isActive
    this.assertTrialIsFree(isTrial, priceUsd)
    if (isTrial && isActive) await this.assertNoOtherTrial(id)
    if (current.isActive && !current.isTrial && (!isActive || isTrial)) await this.assertKeepsAPaidPlan(id)
    const plan = await this.prisma.messagePlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.messages !== undefined ? { messages: dto.messages } : {}),
        ...(dto.priceUsd !== undefined ? { priceUsd: round2(dto.priceUsd) } : {}),
        ...(dto.isTrial !== undefined ? { isTrial: dto.isTrial } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: PLAN_SELECT,
    })
    return this.toPlan(plan)
  }

  /** Retires a plan; its numbers go back to the smallest paid plan. */
  async removePlan(id: number) {
    const plan = await this.findPlan(id)
    if (plan.isActive && !plan.isTrial) await this.assertKeepsAPaidPlan(id)
    await this.prisma.$transaction([
      this.prisma.phoneNumber.updateMany({ where: { planId: id }, data: { planId: null } }),
      this.prisma.messagePlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    ])
    return { ok: true }
  }

  /** The plans anyone may see (the landing): the active ones, with the price of a block past the largest. */
  async publicPlans() {
    const catalog = (await this.usage.catalog()).filter(p => p.isActive)
    const { blockMessages } = this.usage.commercialPricing
    const largest = catalog.filter(p => !p.isTrial).at(-1)
    return {
      blockMessages,
      blockPriceUsd: largest ? round2((blockMessages * largest.priceUsd) / largest.messages) : null,
      plans: catalog.map(p => ({ name: p.name, messages: p.messages, priceUsd: p.priceUsd, isTrial: p.isTrial })),
    }
  }

  // ─── Numbers (organization) ────────────────────────────

  /**
   * The month of every number the user may see: its assigned plan, the plan the
   * month is billed on, how far into it the number is (the consumption bar) and
   * the plan it moves to next. The SuperAdmin also gets the month's total.
   */
  async overview(user: ScopeUser, period = currentPeriod()) {
    this.assertPeriod(period)
    const manager = this.isManager(user)
    const [numbers, catalog] = await Promise.all([
      this.prisma.phoneNumber.findMany({
        where: { producerId: user.producerId, deletedAt: null, ...(await this.numberScope(user)) },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          number: true,
          isActive: true,
          planId: true,
          planUpgradedAt: true,
          planPausedAt: true,
          planPauseConfirmedAt: true,
          extraBlocks: true,
          extraBlocksPeriod: true,
          responsibleProducerCode: { select: { id: true, code: true, holderName: true } },
          usageMonthly: { where: { period }, select: { metaMessages: true, updatedAt: true } },
        },
      }),
      this.usage.catalog(),
    ])
    const starts = await this.usage.serviceStarts(numbers.map(n => n.id))
    const { blockMessages } = this.usage.commercialPricing
    // The organization pays the whole plan; only the owner sees the first month prorated.
    const ownerView = user.role === Role.OWNER
    const running = period === currentPeriod()

    const rows = numbers.map(n => {
      const usage = n.usageMonthly[0]
      const bill = this.usage.billFor(
        {
          isActive: n.isActive,
          serviceStartedAt: starts.get(n.id) ?? null,
          planId: n.planId,
          extraBlocks: acceptedBlocks(n, period),
        },
        usage,
        catalog,
        period,
      )
      const included = bill.plan.includedMessages
      const paused = running && pausedIn(n.planPausedAt, period)
      return {
        id: n.id,
        number: n.number,
        isActive: n.isActive,
        responsibleCode: n.responsibleProducerCode,
        assignedPlan: bill.assignedPlan,
        plan: withLegacyPlan(bill.plan, blockMessages),
        // Past its plan this month, or already moved up to the plan that covers it.
        upgraded: bill.upgraded || movedUpIn(n.planUpgradedAt, period),
        movedUpAt: movedUpIn(n.planUpgradedAt, period) ? n.planUpgradedAt!.toISOString() : null,
        messagesUsed: bill.messages,
        includedMessages: included,
        remainingMessages: Math.max(0, included - bill.messages),
        percentUsed: included > 0 ? Math.round((bill.messages / included) * 1000) / 10 : 0,
        nextPlan: this.withLegacyNext(this.nextPlan(bill.plan, catalog)),
        billedUsd: ownerView ? bill.billedUsd : bill.fullPriceUsd,
        prorated: ownerView && bill.prorated,
        // At the plan's limit the assistant pauses until someone continues on nextPlan or the month ends.
        limit: {
          reached: bill.limitReached,
          paused,
          confirmed: paused && n.planPauseConfirmedAt != null,
          pausedAt: paused ? n.planPausedAt!.toISOString() : null,
          resumesOn: paused ? `${nextPeriod(period)}-01` : null,
        },
        updatedAt: usage?.updatedAt?.toISOString() ?? null,
        // front_John's panel (legacy-token-fields.ts).
        tokensUsed: bill.messages,
        includedTokens: included,
        remainingTokens: Math.max(0, included - bill.messages),
        trialTokens: bill.plan.trial ? included : 0,
      }
    })

    return {
      period,
      blockMessages,
      plans: catalog.filter(p => p.isActive).map(p => ({ ...this.toOffer(p), tokens: p.messages })),
      numbers: rows,
      ...(manager ? { totalBilledUsd: round2(rows.reduce((sum, r) => sum + r.billedUsd, 0)) } : {}),
      // front_John's panel (legacy-token-fields.ts).
      unitPriceUsd: legacyUnitPriceUsd(catalog),
      blockTokens: blockMessages,
      trialTokens: legacyTrialTokens(catalog),
    }
  }

  /**
   * front_John's panel (legacy-token-fields.ts): the active catalog, read-only, under its old route and names. The
   * catalog is the owner's now, so that panel can no longer change it.
   */
  async legacyCatalog() {
    const catalog = (await this.usage.catalog()).filter(p => p.isActive)
    return {
      unitPriceUsd: legacyUnitPriceUsd(catalog),
      plans: catalog.map((p, i) => ({
        id: p.id,
        name: p.name,
        tokens: p.messages,
        priceUsd: p.priceUsd,
        costUsd: p.priceUsd,
        isActive: p.isActive,
        sortOrder: i,
      })),
    }
  }

  /**
   * The SuperAdmin puts a number of the organization on a paid plan of the catalog. A plan bigger than the month's
   * messages also ends a pause for the limit.
   */
  async assignPlan(user: ScopeUser, numberId: number, planId: number) {
    const period = currentPeriod()
    const number = await this.prisma.phoneNumber.findFirst({
      where: { id: numberId, producerId: user.producerId, deletedAt: null },
      select: { id: true, usageMonthly: { where: { period }, select: { metaMessages: true } } },
    })
    if (!number) throw new NotFoundException(`Phone number ${numberId} not found`)
    const plan = await this.prisma.messagePlan.findFirst({
      where: { id: planId, producerId: null, deletedAt: null, isActive: true },
      select: { id: true, isTrial: true, messages: true },
    })
    if (!plan) throw new NotFoundException(`Plan ${planId} not found`)
    if (plan.isTrial)
      throw new BadRequestException('El plan de prueba lo recibe solo un número nuevo de una cuenta nueva.')
    const covers = plan.messages > (number.usageMonthly[0]?.metaMessages ?? 0)
    // The SuperAdmin's choice replaces any block accepted past the largest plan this month.
    await this.prisma.phoneNumber.update({
      where: { id: numberId },
      data: {
        planId,
        planUpgradedAt: null,
        extraBlocks: 0,
        extraBlocksPeriod: null,
        ...(covers ? { planPausedAt: null, planPauseConfirmedAt: null } : {}),
      },
    })
    if (covers) await this.resolveLimitNotices(user.producerId, numberId)
    return { ok: true }
  }

  /**
   * The office's answer when a number reaches its plan and its assistant pauses: "continue" moves it to the smallest
   * plan with more messages than it sent (or one more block past the largest) and the assistant answers again;
   * "pause" keeps it paused until next month. An admin answers only for the numbers billed to their codes.
   */
  async resolveLimit(user: ScopeUser, numberId: number, choice: 'continue' | 'pause') {
    const period = currentPeriod()
    const number = await this.prisma.phoneNumber.findFirst({
      where: { id: numberId, producerId: user.producerId, deletedAt: null, ...(await this.numberScope(user)) },
      select: { id: true, planPausedAt: true, usageMonthly: { where: { period }, select: { metaMessages: true } } },
    })
    if (!number) throw new NotFoundException(`Phone number ${numberId} not found`)
    if (!pausedIn(number.planPausedAt, period)) throw new ConflictException('El número no está en pausa por su plan.')

    if (choice === 'pause') {
      await this.prisma.phoneNumber.update({ where: { id: numberId }, data: { planPauseConfirmedAt: new Date() } })
      await this.resolveLimitNotices(user.producerId, numberId)
      return { ok: true, paused: true }
    }

    const messages = number.usageMonthly[0]?.metaMessages ?? 0
    const paid = (await this.usage.catalog()).filter(p => p.isActive && !p.isTrial)
    const covering = paid.find(p => p.messages > messages)
    const largest = paid.at(-1)
    if (!covering && !largest) throw new BadRequestException('No hay planes pagos activos.')
    const { blockMessages } = this.usage.commercialPricing
    const data = covering
      ? { planId: covering.id, extraBlocks: 0, extraBlocksPeriod: null }
      : {
          planId: largest!.id,
          // Enough blocks for the month's messages and one more: it pauses again at the new limit.
          extraBlocks: Math.floor((messages - largest!.messages) / blockMessages) + 1,
          extraBlocksPeriod: period,
        }
    await this.prisma.phoneNumber.update({
      where: { id: numberId },
      data: { ...data, planUpgradedAt: new Date(), planPausedAt: null, planPauseConfirmedAt: null },
    })
    await this.resolveLimitNotices(user.producerId, numberId)
    return { ok: true, paused: false }
  }

  /** The number's "assistant paused" notices leave Asuntos pendientes once the office answers. */
  private async resolveLimitNotices(producerId: number, numberId: number) {
    await this.prisma.notification.updateMany({
      where: { producerId, type: 'plan', refId: numberId, status: { not: 'resolved' }, deletedAt: null },
      data: { status: 'resolved', resolvedAt: new Date() },
    })
  }

  // ─── Owner dashboard ───────────────────────────────────

  /**
   * What the platform bills each organization in a month and what Meta really
   * charges for it. OpenAI is prepaid, so it is shown apart and left out of the
   * profit: profit = billed − Meta.
   */
  async ownerDashboard(period = currentPeriod()) {
    this.assertPeriod(period)
    const [organizations, catalog] = await Promise.all([
      this.prisma.producer.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          phoneNumbers: {
            where: { deletedAt: null },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              number: true,
              isActive: true,
              planId: true,
              planUpgradedAt: true,
              planPausedAt: true,
              extraBlocks: true,
              extraBlocksPeriod: true,
              responsibleProducerCode: { select: { code: true, holderName: true } },
              usageMonthly: {
                where: { period },
                select: {
                  metaMessages: true,
                  metaBillableMessages: true,
                  metaCostUsd: true,
                  openaiCostUsd: true,
                },
              },
            },
          },
        },
      }),
      this.usage.catalog(),
    ])
    const starts = await this.usage.serviceStarts(organizations.flatMap(o => o.phoneNumbers.map(n => n.id)))

    const zero = () => ({ messages: 0, metaBillableMessages: 0, billedUsd: 0, metaCostUsd: 0, openaiCostUsd: 0 })
    const totals = { ...zero(), profitUsd: 0, activeNumbers: 0, upgradedNumbers: 0, pausedNumbers: 0 }

    const rows = organizations.map(org => {
      const sum = { ...zero(), profitUsd: 0 }
      const numbers = org.phoneNumbers.map(n => {
        const usage = n.usageMonthly[0]
        const bill = this.usage.billFor(
          {
            isActive: n.isActive,
            serviceStartedAt: starts.get(n.id) ?? null,
            planId: n.planId,
            extraBlocks: acceptedBlocks(n, period),
          },
          usage,
          catalog,
          period,
        )
        const metaCostUsd = Number(usage?.metaCostUsd ?? 0)
        const openaiCostUsd = Number(usage?.openaiCostUsd ?? 0)
        const row = {
          id: n.id,
          number: n.number,
          isActive: n.isActive,
          responsibleCode: n.responsibleProducerCode,
          plan: bill.plan,
          assignedPlan: bill.assignedPlan,
          upgraded: bill.upgraded || movedUpIn(n.planUpgradedAt, period),
          prorated: bill.prorated,
          paused: period === currentPeriod() && pausedIn(n.planPausedAt, period),
          messages: bill.messages,
          metaBillableMessages: usage?.metaBillableMessages ?? 0,
          billedUsd: bill.billedUsd,
          metaCostUsd: round2(metaCostUsd),
          openaiCostUsd: round2(openaiCostUsd),
          profitUsd: round2(bill.billedUsd - metaCostUsd),
        }
        sum.messages += row.messages
        sum.metaBillableMessages += row.metaBillableMessages
        sum.billedUsd += row.billedUsd
        sum.metaCostUsd += metaCostUsd
        sum.openaiCostUsd += openaiCostUsd
        if (n.isActive) totals.activeNumbers++
        if (row.upgraded) totals.upgradedNumbers++
        if (row.paused) totals.pausedNumbers++
        return row
      })
      sum.profitUsd = sum.billedUsd - sum.metaCostUsd
      totals.messages += sum.messages
      totals.metaBillableMessages += sum.metaBillableMessages
      totals.billedUsd += sum.billedUsd
      totals.metaCostUsd += sum.metaCostUsd
      totals.openaiCostUsd += sum.openaiCostUsd
      return {
        id: org.id,
        name: org.name,
        isActive: org.isActive,
        numbers,
        totals: {
          messages: sum.messages,
          metaBillableMessages: sum.metaBillableMessages,
          billedUsd: round2(sum.billedUsd),
          metaCostUsd: round2(sum.metaCostUsd),
          openaiCostUsd: round2(sum.openaiCostUsd),
          profitUsd: round2(sum.profitUsd),
        },
      }
    })

    return {
      period,
      organizations: rows,
      totals: {
        organizations: rows.length,
        activeNumbers: totals.activeNumbers,
        upgradedNumbers: totals.upgradedNumbers,
        pausedNumbers: totals.pausedNumbers,
        messages: totals.messages,
        metaBillableMessages: totals.metaBillableMessages,
        billedUsd: round2(totals.billedUsd),
        metaCostUsd: round2(totals.metaCostUsd),
        openaiCostUsd: round2(totals.openaiCostUsd),
        profitUsd: round2(totals.billedUsd - totals.metaCostUsd),
      },
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private withLegacyNext(next: ReturnType<BillingService['nextPlan']>) {
    return next ? { ...next, tokens: next.messages } : null
  }

  /** The plan after `current`: the next active paid plan, or the next block past the largest. */
  private nextPlan(current: BilledPlan, catalog: CatalogPlan[]) {
    return this.usage.nextPlanAfter(current, catalog)
  }

  private assertPeriod(period: string) {
    if (!PERIOD_RE.test(period) || period > currentPeriod()) throw new BadRequestException('Mes inválido')
  }

  private assertTrialIsFree(isTrial: boolean, priceUsd: number) {
    if (isTrial && priceUsd !== 0)
      throw new BadRequestException('El plan de prueba es gratis: su precio tiene que ser 0.')
  }

  private async assertNoOtherTrial(exceptId: number | null) {
    const other = await this.prisma.messagePlan.findFirst({
      where: {
        producerId: null,
        deletedAt: null,
        isActive: true,
        isTrial: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    })
    if (other) throw new ConflictException(`Ya hay un plan de prueba activo (${other.name}).`)
  }

  /** Billing needs a paid plan to fall back on: the last active one cannot go. */
  private async assertKeepsAPaidPlan(exceptId: number) {
    const others = await this.prisma.messagePlan.count({
      where: { producerId: null, deletedAt: null, isActive: true, isTrial: false, id: { not: exceptId } },
    })
    if (others === 0) throw new BadRequestException('Tiene que quedar al menos un plan pago activo.')
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

  private async findPlan(id: number) {
    const plan = await this.prisma.messagePlan.findFirst({
      where: { id, producerId: null, deletedAt: null },
      select: { id: true, priceUsd: true, isTrial: true, isActive: true },
    })
    if (!plan) throw new NotFoundException(`Plan ${id} not found`)
    return plan
  }

  private async nextSortOrder(): Promise<number> {
    const last = await this.prisma.messagePlan.aggregate({
      where: { producerId: null, deletedAt: null },
      _max: { sortOrder: true },
    })
    return (last._max.sortOrder ?? -1) + 1
  }

  private toPlan(plan: PlanRow) {
    return {
      id: plan.id,
      name: plan.name,
      messages: plan.messages,
      priceUsd: Number(plan.priceUsd),
      isTrial: plan.isTrial,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    }
  }

  private toOffer(plan: CatalogPlan) {
    return { id: plan.id, name: plan.name, messages: plan.messages, priceUsd: plan.priceUsd, isTrial: plan.isTrial }
  }
}
