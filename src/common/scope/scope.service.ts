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
    // OWNER behaves like a SUPERADMIN for cartera scoping: it sees every code of
    // the organization it is currently operating in (user.producerId).
    if (user.role === Role.SUPERADMIN || user.role === Role.OWNER) {
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
   * Unified section filter for the admin views. Narrows the accessible codes by
   * EITHER a specific producer code OR a specific phone number (a number resolves
   * to the codes it serves). Both inputs stay within what the user may access, so
   * a SuperAdmin's "filter by número/productor" can never leak another org's data.
   * `producerCodeId` wins if both are provided (the combobox only sends one).
   */
  async resolveScopedCodeIdsFor(
    user: ScopeUser,
    input: { producerCodeId?: number | null; phoneNumberId?: number | null },
  ): Promise<number[]> {
    const accessible = await this.resolveAccessibleProducerCodeIds(user)
    if (input.producerCodeId != null) {
      return accessible.includes(input.producerCodeId) ? [input.producerCodeId] : []
    }
    if (input.phoneNumberId != null) {
      const codeIds = await this.codeIdsForPhoneNumber(user.producerId, input.phoneNumberId)
      return accessible.filter(id => codeIds.includes(id))
    }
    return accessible
  }

  /** Producer codes a phone number serves (responsible + served), within an org. */
  async codeIdsForPhoneNumber(producerId: number, phoneNumberId: number): Promise<number[]> {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id: phoneNumberId, producerId, deletedAt: null },
      select: { responsibleProducerCodeId: true, servedCodes: { select: { producerCodeId: true } } },
    })
    if (!phone) return []
    const ids = new Set<number>()
    if (phone.responsibleProducerCodeId != null) ids.add(phone.responsibleProducerCodeId)
    for (const s of phone.servedCodes) ids.add(s.producerCodeId)
    return [...ids]
  }

  /** Meta phone_number_id string of a PhoneNumber row (for conversation filtering). */
  async metaPhoneNumberId(producerId: number, phoneNumberId: number): Promise<string | null> {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id: phoneNumberId, producerId, deletedAt: null },
      select: { phoneNumberId: true },
    })
    return phone?.phoneNumberId ?? null
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
