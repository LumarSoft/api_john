import type { PrismaService } from '../prisma/prisma.service'
import { checkClaimCoverage, COVERAGE_OK, termPosition, type ClaimCoverageCheck } from './claim-coverage'

const TERM_SELECT = {
  certificateNumber: true,
  endorsementNumber: true,
  lastMovement: true,
  validFrom: true,
  validTo: true,
  rawData: true,
} as const

/**
 * The coverage check of each claim (see checkClaimCoverage), by claim id, read
 * from the cartera as it is now. Shared by the panel's claims and the claim
 * the bot files. The policies' raw rows are read here and never returned.
 */
export async function claimCoverageChecks(
  prisma: Pick<PrismaService, 'policy'>,
  claims: Array<{ id: number; occurredAt: Date; policyId: number }>,
): Promise<Map<number, ClaimCoverageCheck>> {
  const checks = new Map<number, ClaimCoverageCheck>()
  if (claims.length === 0) return checks

  const policies = await prisma.policy.findMany({
    where: { id: { in: [...new Set(claims.map(claim => claim.policyId))] } },
    select: {
      ...TERM_SELECT,
      id: true,
      clientId: true,
      producerId: true,
      riskType: true,
      vehicle: { select: { licensePlate: true } },
      installments: {
        where: { deletedAt: null, status: { in: ['pending', 'overdue'] } },
        select: { number: true, dueDate: true, status: true, providerStatus: true },
      },
      paymentRejections: {
        where: { deletedAt: null, stillPending: true },
        orderBy: { createdAt: 'desc' },
        select: { installmentNumber: true, reason: true },
      },
    },
  })
  const byId = new Map(policies.map(policy => [policy.id, policy]))

  for (const claim of claims) {
    const policy = byId.get(claim.policyId)
    if (!policy) {
      checks.set(claim.id, COVERAGE_OK)
      continue
    }
    // Outside the term is rare; only then is the client's other cover looked up:
    // an incident from before a renewal belongs to the policy it replaced.
    const outside = termPosition(policy, claim.occurredAt.toISOString().slice(0, 10)) !== 'inside'
    const plate = policy.vehicle?.licensePlate?.trim()
    const otherPolicies = outside
      ? await prisma.policy.findMany({
          where: {
            clientId: policy.clientId,
            producerId: policy.producerId,
            deletedAt: null,
            id: { not: policy.id },
            ...(plate ? { vehicle: { licensePlate: plate } } : { riskType: policy.riskType, vehicle: null }),
          },
          select: TERM_SELECT,
        })
      : []
    checks.set(
      claim.id,
      checkClaimCoverage({
        occurredAt: claim.occurredAt,
        policy,
        installments: policy.installments,
        rejections: policy.paymentRejections,
        otherPolicies,
      }),
    )
  }
  return checks
}
