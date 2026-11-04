import { ForbiddenException, Injectable } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeUser } from '../common/scope/scope.service'
import { CatalogPlan, currentPeriod, UsageService } from '../usage/usage.service'
import {
  allFeatures,
  FEATURE_NOT_IN_PLAN,
  featuresOf,
  PLAN_FEATURES,
  PlanFeatureKey,
  PlanFeatures,
  unionOf,
} from './plan-features'

/** A number as the plan check needs it. */
export interface PlannedNumber {
  id: number
  /** The plan the SuperAdmin assigned (null = the smallest paid plan). */
  planId: number | null
}

export interface OrganizationFeatures {
  /** What the organization may use: a function counts when the plan of one of its active numbers includes it. */
  features: PlanFeatures
  /** The cheapest active paid plan that includes each function ("disponible en el plan X"), or null. */
  availableIn: Record<PlanFeatureKey, string | null>
}

/**
 * Which panel functions an organization may use, from the plans of its
 * numbers (see plan-features.ts). The plan is the one billing reads: the
 * assigned plan, the trial only in the number's first month, else the
 * smallest paid plan.
 */
@Injectable()
export class PlanFeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  /** The functions of the user's organization; the owner has them all. */
  async forUser(user: ScopeUser): Promise<OrganizationFeatures> {
    const [catalog, stored] = await this.load()
    const features =
      user.role === Role.OWNER ? allFeatures() : await this.organizationFeatures(user.producerId, catalog, stored)
    return { features, availableIn: this.availableIn(catalog, stored) }
  }

  /** True when the plan of one of the organization's active numbers includes `key`. */
  async hasFeature(producerId: number, key: PlanFeatureKey): Promise<boolean> {
    const [catalog, stored] = await this.load()
    return (await this.organizationFeatures(producerId, catalog, stored))[key]
  }

  /**
   * The numbers among `numbers` whose plan includes `key`. When there are
   * numbers but none of them has it, the plan is the reason nothing can go
   * out: it answers 403 with the message for that function.
   */
  async keepWith<T extends PlannedNumber>(numbers: T[], key: PlanFeatureKey): Promise<T[]> {
    if (!numbers.length) return numbers
    const [catalog, stored] = await this.load()
    const plans = await this.plansOf(numbers, catalog)
    const kept = numbers.filter((_, i) => this.featuresOfPlan(plans[i], stored)[key])
    if (!kept.length) throw new ForbiddenException(FEATURE_NOT_IN_PLAN[key])
    return kept
  }

  // ─── Internals ─────────────────────────────────────────

  private async load(): Promise<[CatalogPlan[], Map<number, PlanFeatures>]> {
    const [catalog, rows] = await Promise.all([
      this.usage.catalog(),
      this.prisma.messagePlan.findMany({
        where: { producerId: null, deletedAt: null },
        select: { id: true, features: true },
      }),
    ])
    return [catalog, new Map(rows.map(r => [r.id, featuresOf(r.features)]))]
  }

  private async organizationFeatures(
    producerId: number,
    catalog: CatalogPlan[],
    stored: Map<number, PlanFeatures>,
  ): Promise<PlanFeatures> {
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId, isActive: true, deletedAt: null },
      select: { id: true, planId: true },
    })
    if (!numbers.length) {
      // No number yet: the plan its first number will start on.
      const planId = await this.usage.initialPlanIdFor(producerId)
      return this.featuresOfPlan(this.usage.assignedPlanFor(planId, catalog, true)?.id ?? null, stored)
    }
    const plans = await this.plansOf(numbers, catalog)
    return unionOf(plans.map(id => this.featuresOfPlan(id, stored)))
  }

  /** The catalog plan each number is on this month (null when the catalog has no plan to put it on). */
  private async plansOf(numbers: PlannedNumber[], catalog: CatalogPlan[]): Promise<Array<number | null>> {
    const starts = await this.usage.serviceStarts(numbers.map(n => n.id))
    const period = currentPeriod()
    return numbers.map(n => {
      const start = starts.get(n.id)
      const firstMonth = !start || currentPeriod(start) === period
      return this.usage.assignedPlanFor(n.planId, catalog, firstMonth)?.id ?? null
    })
  }

  private featuresOfPlan(planId: number | null, stored: Map<number, PlanFeatures>): PlanFeatures {
    return (planId != null ? stored.get(planId) : undefined) ?? allFeatures()
  }

  private availableIn(
    catalog: CatalogPlan[],
    stored: Map<number, PlanFeatures>,
  ): Record<PlanFeatureKey, string | null> {
    // usage.catalog() comes smallest first.
    const paid = catalog.filter(p => p.isActive && !p.isTrial)
    return Object.fromEntries(
      PLAN_FEATURES.map(f => [f.key, paid.find(p => this.featuresOfPlan(p.id, stored)[f.key])?.name ?? null]),
    ) as Record<PlanFeatureKey, string | null>
  }
}
