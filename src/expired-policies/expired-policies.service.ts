import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { notCancelledPolizaWhere } from '../common/poliza-vigencia'
import { productNameOf } from '../common/poliza-detail'
import { ExpiredPolicySort, ListExpiredPoliciesDto } from './dto/list-expired-policies.dto'

/**
 * Older than this and nobody is going to renew: in production every expired
 * policy still worth a call was within the year, and the rest was noise.
 */
const MAX_DAYS_EXPIRED = 365

const DAY_MS = 86_400_000

const ROW_SELECT = {
  id: true,
  certificateNumber: true,
  riskType: true,
  validTo: true,
  paymentMethod: true,
  rawData: true,
  hiddenAt: true,
  hiddenReason: true,
  clientId: true,
  producerCode: { select: { id: true, code: true } },
  client: { select: { id: true, firstName: true, lastName: true, dni: true, phone: true, email: true } },
  vehicle: { select: { licensePlate: true, brand: true, model: true, year: true } },
  installments: {
    where: { deletedAt: null, status: { in: ['pending', 'overdue', 'rejected'] } },
    select: { id: true },
  },
} satisfies Prisma.PolicySelect

type PolicyRow = Prisma.PolicyGetPayload<{ select: typeof ROW_SELECT }>

/**
 * The "pólizas vencidas" worklist of the cobranzas screen: policies that ran
 * out and were not renewed, so the office can call and offer a renewal, or
 * hide the ones it knows are gone for good.
 *
 * In production 3,249 policies had an end date in the past, but 1,062 were
 * cancelled by Triunfo and 2,191 had the same plate on a policy in force for
 * the same client — renewals, which get a new certificate and leave the old
 * row behind. What was left: 195 policies of 180 clients, all within the year.
 */
@Injectable()
export class ExpiredPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(producerId: number, codeIds: number[], query: ListExpiredPoliciesDto, now = new Date()) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const scope = this.scopeWhere(producerId, codeIds, query, now)

    const [candidates, hiddenCount] = await Promise.all([
      this.prisma.policy.findMany({
        where: { ...scope, hiddenAt: query.hidden ? { not: null } : null },
        select: ROW_SELECT,
      }),
      this.prisma.policy.count({ where: { ...scope, hiddenAt: { not: null } } }),
    ])

    const renewed = await this.renewedKeys(
      producerId,
      candidates.map(p => p.clientId),
      now,
    )
    const rows = candidates
      .filter(p => !renewed.has(renewalKey(p.clientId, p.vehicle?.licensePlate, p.riskType)))
      .map(p => this.toRow(p, now))

    const direction = query.sort === ExpiredPolicySort.RECENT ? -1 : 1
    rows.sort(
      (a, b) => direction * (b.daysExpired - a.daysExpired) || a.client.lastName.localeCompare(b.client.lastName),
    )

    const total = rows.length
    const data = rows.slice((page - 1) * pageSize, page * pageSize)
    return { data, total, hiddenCount, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  async hide(id: number, producerId: number, codeIds: number[], userId: number, reason?: string) {
    await this.findInScope(id, producerId, codeIds)
    const reasonText = reason?.trim() || null
    return this.prisma.policy.update({
      where: { id },
      data: { hiddenAt: new Date(), hiddenReason: reasonText, hiddenById: userId },
      select: { id: true, hiddenAt: true, hiddenReason: true },
    })
  }

  async unhide(id: number, producerId: number, codeIds: number[]) {
    await this.findInScope(id, producerId, codeIds)
    return this.prisma.policy.update({
      where: { id },
      data: { hiddenAt: null, hiddenReason: null, hiddenById: null },
      select: { id: true, hiddenAt: true, hiddenReason: true },
    })
  }

  private async findInScope(id: number, producerId: number, codeIds: number[]) {
    const policy = await this.prisma.policy.findFirst({
      where: { id, producerId, deletedAt: null, producerCodeId: { in: codeIds } },
      select: { id: true },
    })
    if (!policy) throw new NotFoundException(`Policy ${id} not found`)
    return policy
  }

  /** Expired within the year, not cancelled, of the codes and medio de pago in scope. */
  private scopeWhere(
    producerId: number,
    codeIds: number[],
    query: ListExpiredPoliciesDto,
    now: Date,
  ): Prisma.PolicyWhereInput {
    const where: Prisma.PolicyWhereInput = {
      producerId,
      deletedAt: null,
      producerCodeId: { in: codeIds },
      ...notCancelledPolizaWhere(),
      validTo: { lt: now, gte: new Date(now.getTime() - MAX_DAYS_EXPIRED * DAY_MS) },
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    }

    const search = query.search?.trim()
    if (search) {
      where.AND = search
        .split(/\s+/)
        .filter(Boolean)
        .map(word => ({
          OR: [
            { certificateNumber: { contains: word } },
            { vehicle: { licensePlate: { contains: word } } },
            {
              client: {
                OR: [{ firstName: { contains: word } }, { lastName: { contains: word } }, { dni: { contains: word } }],
              },
            },
          ],
        }))
    }
    return where
  }

  /**
   * What these clients still have running (in force or about to start): a
   * policy on the same plate, or on the same kind of risk when there is no
   * plate, means the expired one was renewed under a new certificate.
   */
  private async renewedKeys(producerId: number, clientIds: number[], now: Date): Promise<Set<string>> {
    if (clientIds.length === 0) return new Set()
    const current = await this.prisma.policy.findMany({
      where: {
        producerId,
        deletedAt: null,
        clientId: { in: [...new Set(clientIds)] },
        validTo: { gte: now },
        ...notCancelledPolizaWhere(),
      },
      select: { clientId: true, riskType: true, vehicle: { select: { licensePlate: true } } },
    })
    return new Set(current.map(p => renewalKey(p.clientId, p.vehicle?.licensePlate, p.riskType)))
  }

  private toRow(p: PolicyRow, now: Date) {
    const vehicle = p.vehicle
    const vehicleLabel = vehicle ? [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' ') || null : null
    return {
      id: p.id,
      certificateNumber: p.certificateNumber,
      riskType: p.riskType,
      product: productNameOf(p.riskType, p.rawData),
      licensePlate: vehicle?.licensePlate ?? null,
      vehicle: vehicleLabel,
      validTo: p.validTo?.toISOString() ?? null,
      daysExpired: p.validTo ? Math.floor((now.getTime() - p.validTo.getTime()) / DAY_MS) : 0,
      paymentMethod: p.paymentMethod,
      producerCode: p.producerCode,
      client: p.client,
      unpaidInstallments: p.installments.length,
      hiddenAt: p.hiddenAt?.toISOString() ?? null,
      hiddenReason: p.hiddenReason,
    }
  }
}

function renewalKey(clientId: number, licensePlate: string | null | undefined, riskType: string): string {
  const plate = licensePlate?.replace(/\s+/g, '').toUpperCase()
  return plate ? `${clientId}:plate:${plate}` : `${clientId}:risk:${riskType}`
}
