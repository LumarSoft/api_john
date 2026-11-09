import type { PrismaService } from '../prisma/prisma.service'
import { CommercialPricing, startsOnTrial } from './commercial-pricing'

/**
 * The plan a new number starts on: the catalog's active trial plan for a new
 * account's number (organizations created from the trial date on), otherwise
 * none, which bills it on the smallest paid plan.
 */
export async function initialPlanId(
  prisma: PrismaService,
  pricing: CommercialPricing,
  producerId: number,
): Promise<number | null> {
  const organization = await prisma.producer.findUnique({ where: { id: producerId }, select: { createdAt: true } })
  if (!organization || !startsOnTrial(pricing, organization.createdAt)) return null
  const trial = await prisma.messagePlan.findFirst({
    where: { producerId: null, deletedAt: null, isActive: true, isTrial: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  return trial?.id ?? null
}
