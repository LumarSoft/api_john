import type { PrismaService } from '../prisma/prisma.service'
import { CommercialPricing, startsOnTrial } from './commercial-pricing'

/**
 * The plan a new number starts on, which is also the plan of an organization
 * with no number yet: the plan the owner put the organization on while the
 * catalog still offers it; otherwise the catalog's active trial plan for a new
 * account (organizations created from the trial date on), otherwise none,
 * which bills the number on the smallest paid plan.
 */
export async function initialPlanId(
  prisma: PrismaService,
  pricing: CommercialPricing,
  producerId: number,
): Promise<number | null> {
  const organization = await prisma.producer.findUnique({
    where: { id: producerId },
    select: {
      createdAt: true,
      plan: { select: { id: true, isActive: true, deletedAt: true, producerId: true } },
    },
  })
  if (!organization) return null
  const chosen = organization.plan
  if (chosen && chosen.isActive && !chosen.deletedAt && chosen.producerId === null) return chosen.id
  if (!startsOnTrial(pricing, organization.createdAt)) return null
  const trial = await prisma.messagePlan.findFirst({
    where: { producerId: null, deletedAt: null, isActive: true, isTrial: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return trial?.id ?? null
}
