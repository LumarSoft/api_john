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
 * Which WhatsApp chats a user sees. The SuperAdmin (and the OWNER): those of
 * `codeIds` plus the ones not attributed to a code yet. An admin: only the chats
 * that came through their own numbers, whatever their code.
 */
export interface ChatScope {
  codeIds: number[]
  /** Meta ids of the admin's own numbers (billed to one of their codes); null = not limited by number. */
  ownNumbers: string[] | null
  /** Meta id of the number the user filtered by (the section filter); null = every number they see. */
  filterNumber?: string | null
  /**
   * Meta id of the organization's default number (the one billed to the master
   * code): whatever came through no number (web, panel, older rows) counts as its.
   */
  defaultNumber?: string | null
}

/** Prisma fragment on a `phoneNumberId` column (Notification, ContactLead, Quote). */
export type NumberWhere =
  | Record<string, never>
  | { phoneNumberId: { in: string[] } }
  | { OR: Array<{ phoneNumberId: { in: string[] } } | { phoneNumberId: null }> }

/**
 * What a user sees of the things that came through a WhatsApp number: an admin
 * only their own numbers' (plus, when one of them is the organization's default
 * number, what came through no number); the SuperAdmin everything, or the number
 * they filtered by (the default number also brings what came through none).
 */
export function numberWhere(scope: ChatScope): NumberWhere {
  const filter = scope.filterNumber
  // A filter set to a number that is not the organization's ('') or not the
  // admin's own sees nothing, never everything.
  const visible =
    filter != null
      ? filter === '' || (scope.ownNumbers && !scope.ownNumbers.includes(filter))
        ? []
        : [filter]
      : scope.ownNumbers
  if (visible === null) return {}
  const withNone = scope.defaultNumber != null && visible.includes(scope.defaultNumber)
  return withNone
    ? { OR: [{ phoneNumberId: { in: visible } }, { phoneNumberId: null }] }
    : { phoneNumberId: { in: visible } }
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

  /**
   * The chats a user sees (see ChatScope). `codeIds` defaults to every code the
   * user may access; pass the narrowed ones of a section filter instead.
   * `requestedPhoneNumberId` (a PhoneNumber id, the section filter's "número")
   * narrows to that number: unknown or outside the organization sees nothing.
   */
  async resolveChatScope(
    user: ScopeUser,
    codeIds?: number[],
    requestedPhoneNumberId?: number | null,
  ): Promise<ChatScope> {
    const [resolvedCodeIds, ownNumbers, defaultNumber, filterNumber] = await Promise.all([
      codeIds ? Promise.resolve(codeIds) : this.resolveAccessibleProducerCodeIds(user),
      this.ownMetaPhoneNumberIds(user),
      this.defaultMetaPhoneNumberId(user.producerId),
      requestedPhoneNumberId != null ? this.metaPhoneNumberId(user.producerId, requestedPhoneNumberId) : null,
    ])
    return {
      codeIds: resolvedCodeIds,
      ownNumbers,
      defaultNumber,
      // A number that is not the organization's: see nothing rather than everything.
      filterNumber: requestedPhoneNumberId != null ? (filterNumber ?? '') : null,
    }
  }

  /**
   * The organization's default number: the active one billed to the master
   * code (the office line). What came through no number is shown as its.
   */
  async defaultPhoneNumber(producerId: number): Promise<{ id: number; phoneNumberId: string; number: string } | null> {
    return this.prisma.phoneNumber.findFirst({
      where: { producerId, deletedAt: null, isActive: true, responsibleProducerCode: { isMaster: true } },
      orderBy: { id: 'asc' },
      select: { id: true, phoneNumberId: true, number: true },
    })
  }

  async defaultMetaPhoneNumberId(producerId: number): Promise<string | null> {
    return (await this.defaultPhoneNumber(producerId))?.phoneNumberId ?? null
  }

  /**
   * Meta ids of an admin's own numbers: those of the organization billed to one
   * of their codes. Null for the SuperAdmin and the OWNER, who see every number.
   */
  async ownMetaPhoneNumberIds(user: ScopeUser): Promise<string[] | null> {
    if (user.role === Role.SUPERADMIN || user.role === Role.OWNER) return null
    const codeIds = await this.resolveAccessibleProducerCodeIds(user)
    const phones = await this.prisma.phoneNumber.findMany({
      where: { producerId: user.producerId, deletedAt: null, responsibleProducerCodeId: { in: codeIds } },
      select: { phoneNumberId: true },
    })
    return phones.map(p => p.phoneNumberId)
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
