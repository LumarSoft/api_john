import { Injectable } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

/** Minimal user shape needed to resolve scope (subset of AuthenticatedRequest.user). */
export interface ScopeUser {
  id: number
  producerId: number
  // Optional to match AuthenticatedRequest.user; undefined is treated as ADMIN.
  role?: Role
}

/** Prisma `where` fragment that scopes a query to the codes a user may access. */
export interface ScopeWhere {
  producerId: number
  producerCodeId: { in: number[] }
}

/**
 * Resolves, for an authenticated admin user, which Triunfo producer codes they
 * are allowed to see:
 *   - SUPERADMIN → every (active) code of their organization.
 *   - ADMIN      → only the codes granted via UserProducerCode.
 *
 * Admin-facing services must scope every cartera query by these ids (in addition
 * to producerId) so an admin never sees another code's clients/policies/etc.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveAccessibleProducerCodeIds(user: ScopeUser): Promise<number[]> {
    if (user.role === Role.SUPERADMIN) {
      const codes = await this.prisma.producerCode.findMany({
        where: { producerId: user.producerId, deletedAt: null },
        select: { id: true },
      })
      return codes.map(c => c.id)
    }

    const grants = await this.prisma.userProducerCode.findMany({
      where: { userId: user.id, producerCode: { producerId: user.producerId, deletedAt: null } },
      select: { producerCodeId: true },
    })
    return grants.map(g => g.producerCodeId)
  }

  /**
   * Like resolveAccessibleProducerCodeIds, but narrows to a single requested code
   * (the SuperAdmin/admin "filter by código" selector). If the requested code is
   * not accessible to the user, returns [] (sees nothing) instead of leaking it.
   */
  async resolveScopedCodeIds(user: ScopeUser, requestedCodeId?: number | null): Promise<number[]> {
    const accessible = await this.resolveAccessibleProducerCodeIds(user)
    if (requestedCodeId == null) return accessible
    return accessible.includes(requestedCodeId) ? [requestedCodeId] : []
  }

  /**
   * Convenience: builds the `{ producerId, producerCodeId: { in } }` filter to
   * spread into a Prisma `where`. An admin with no grants yields `in: []`, which
   * correctly returns nothing.
   */
  async buildScopeWhere(user: ScopeUser): Promise<ScopeWhere> {
    const ids = await this.resolveAccessibleProducerCodeIds(user)
    return { producerId: user.producerId, producerCodeId: { in: ids } }
  }

  /** True if the user may access the given producer code id. */
  async canAccessCode(user: ScopeUser, producerCodeId: number): Promise<boolean> {
    const ids = await this.resolveAccessibleProducerCodeIds(user)
    return ids.includes(producerCodeId)
  }
}
