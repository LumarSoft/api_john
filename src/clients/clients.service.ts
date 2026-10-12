import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RiskType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { validityStatus, expiringPolizaWhere, inForcePolizaWhere } from '../common/poliza-vigencia'
import { ClientStatusFilter, ClientSort, ListClientsDto } from './dto/list-clients.dto'
import { CollectionStatusFilter, ListCobranzasDto } from './dto/list-cobranzas.dto'

// ─── Insured item extracted from rawData.SDTOtrosRiesgosDatos ────────────────
// Present on non-vehicle policies (life, home, commercial, other).
// Never sent on vehicle policies (they use the Vehicle relation instead).

export interface InsuredItemCoverage {
  risk: string
  coverage: string
  sumInsured: string
}

export interface InsuredItem {
  description: string | null
  coverages: InsuredItemCoverage[]
}

function extractInsuredItem(rawData: Prisma.JsonValue): InsuredItem | null {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const raw = rawData as Record<string, Prisma.JsonValue>
  const otros = raw.SDTOtrosRiesgosDatos
  if (!otros || typeof otros !== 'object' || Array.isArray(otros)) return null
  const o = otros as Record<string, Prisma.JsonValue>

  const description =
    typeof o.ObjetoSeguroDescripcion === 'string' && o.ObjetoSeguroDescripcion.trim()
      ? o.ObjetoSeguroDescripcion.trim()
      : null

  const coverages: InsuredItemCoverage[] = []
  if (Array.isArray(o.SDTRiesgosCoberturas)) {
    for (const c of o.SDTRiesgosCoberturas) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const cob = c as Record<string, Prisma.JsonValue>
        if (typeof cob.Riesgo === 'string' && typeof cob.Cobertura === 'string') {
          coverages.push({
            risk: cob.Riesgo,
            coverage: cob.Cobertura,
            sumInsured: typeof cob.SumaAsegurada === 'string' ? cob.SumaAsegurada : '0.00',
          })
        }
      }
    }
  }

  if (!description && coverages.length === 0) return null
  return { description, coverages }
}

const DEFAULT_PAGE_SIZE = 20
const EXPIRING_WINDOW_DAYS = 30

const ADMIN_CLIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  city: true,
  dni: true,
  createdAt: true,
  policies: {
    where: { deletedAt: null },
    select: {
      id: true,
      certificateNumber: true,
      riskType: true,
      lastMovement: true,
      validFrom: true,
      validTo: true,
      premium: true,
      vehicle: {
        select: {
          id: true,
          licensePlate: true,
          brand: true,
          model: true,
          version: true,
          year: true,
          coverage: true,
          sumInsured: true,
        },
      },
      installments: {
        where: { deletedAt: null },
        select: { status: true },
      },
    },
    orderBy: { validTo: 'asc' as const },
  },
} as const

const ADMIN_CLIENT_DETAIL_SELECT = {
  ...ADMIN_CLIENT_SELECT,
  policies: {
    where: { deletedAt: null },
    select: {
      id: true,
      certificateNumber: true,
      endorsementNumber: true,
      company: true,
      riskType: true,
      lastMovement: true,
      validFrom: true,
      validTo: true,
      premium: true,
      paymentMethod: true,
      vehicle: {
        select: {
          id: true,
          licensePlate: true,
          brand: true,
          model: true,
          version: true,
          year: true,
          type: true,
          usage: true,
          coverage: true,
          sumInsured: true,
          isZeroKm: true,
          chassisNumber: true,
          engineNumber: true,
        },
      },
      installments: {
        where: { deletedAt: null },
        select: {
          id: true,
          number: true,
          amount: true,
          dueDate: true,
          status: true,
        },
        orderBy: { number: 'asc' as const },
      },
    },
    orderBy: { validTo: 'asc' as const },
  },
} as const

// Poliza shape fetched from DB — rawData is extracted server-side and dropped from the response
const POLIZA_LIST_SELECT = {
  id: true,
  certificateNumber: true,
  endorsementNumber: true,
  company: true,
  riskType: true,
  lastMovement: true,
  validFrom: true,
  validTo: true,
  premium: true,
  paymentMethod: true,
  createdAt: true,
  rawData: true,
  vehicle: {
    select: {
      id: true,
      licensePlate: true,
      brand: true,
      model: true,
      version: true,
      year: true,
      type: true,
      usage: true,
      coverage: true,
      sumInsured: true,
      isZeroKm: true,
      chassisNumber: true,
      engineNumber: true,
    },
  },
  installments: {
    where: { deletedAt: null },
    select: {
      id: true,
      number: true,
      amount: true,
      dueDate: true,
      status: true,
    },
    orderBy: { number: 'asc' as const },
  },
} as const

// Full detail shape — includes installments, still omits rawData and password fields
const POLIZA_DETAIL_SELECT = {
  ...POLIZA_LIST_SELECT,
  installments: {
    where: { deletedAt: null },
    select: {
      id: true,
      number: true,
      amount: true,
      dueDate: true,
      status: true,
    },
    orderBy: { number: 'asc' as const },
  },
} as const

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findPolizas(clientId: number, producerId: number) {
    const policies = await this.prisma.policy.findMany({
      where: { clientId, producerId, deletedAt: null },
      select: POLIZA_LIST_SELECT,
      orderBy: { validFrom: 'desc' },
    })

    const now = new Date()
    const withStatus = policies.map(p => ({ ...p, validityStatus: validityStatus(p, now) }))

    // One vehicle accumulates a policy per renewal/replacement. Per plate show
    // what matters today — the policy in force and its upcoming renewal, each
    // labelled — or, when neither exists, only the most recent one (expired or
    // cancelled). Rows are ordered by validFrom desc, so the first one seen
    // for a plate is its most recent.
    const activePlates = new Set(
      withStatus
        .filter(p => p.vehicle?.licensePlate && (p.validityStatus === 'vigente' || p.validityStatus === 'proxima'))
        .map(p => p.vehicle!.licensePlate),
    )
    const seenInactivePlate = new Set<string>()

    return withStatus
      .filter(p => {
        const licensePlate = p.vehicle?.licensePlate
        if (!licensePlate) return true
        if (activePlates.has(licensePlate)) return p.validityStatus === 'vigente' || p.validityStatus === 'proxima'
        if (seenInactivePlate.has(licensePlate)) return false
        seenInactivePlate.add(licensePlate)
        return true
      })
      .map(({ rawData, ...rest }) => ({ ...rest, insuredItem: extractInsuredItem(rawData) }))
  }

  async findAllForAdmin(producerId: number, codeIds: number[], query: ListClientsDto) {
    const page = query.page && query.page > 0 ? query.page : 1
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE
    const where = this.buildAdminWhere(producerId, codeIds, query)

    const [total, raw] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        select: ADMIN_CLIENT_SELECT,
        orderBy: this.buildAdminOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    const data = raw.map(client => {
      const allCuotas = client.policies.flatMap(p => p.installments)
      return {
        ...client,
        policies: client.policies.map(({ installments: _, ...p }) => ({ ...p, validityStatus: validityStatus(p) })),
        installmentStats: {
          pending: allCuotas.filter(c => c.status === 'pending').length,
          overdue: allCuotas.filter(c => c.status === 'overdue').length,
          rejected: allCuotas.filter(c => c.status === 'rejected').length,
          paid: allCuotas.filter(c => c.status === 'paid').length,
        },
      }
    })

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async getAdminStats(producerId: number, codeIds: number[]) {
    const now = new Date()
    const expiringLimit = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)
    const codeScope = { producerCodeId: { in: codeIds } }
    const activePoliza = { producerId, deletedAt: null, ...codeScope }

    const [totalClients, inForce, expiringSoon, expired, overdueInstallments] = await this.prisma.$transaction([
      this.prisma.client.count({ where: { producerId, deletedAt: null, ...this.clientVisibility(codeIds) } }),
      this.prisma.policy.count({ where: { AND: [activePoliza, inForcePolizaWhere(now)] } }),
      this.prisma.policy.count({ where: { AND: [activePoliza, expiringPolizaWhere(expiringLimit, now)] } }),
      this.prisma.policy.count({ where: { ...activePoliza, validTo: { lt: now } } }),
      this.prisma.installment.count({
        where: { deletedAt: null, status: 'overdue', policy: { producerId, deletedAt: null, ...codeScope } },
      }),
    ])

    return { totalClients, inForce, expiringSoon, expired, overdueInstallments }
  }

  // A client is visible to an admin if it's attributed to an accessible code OR
  // holds at least one policy under an accessible code. This matters because the
  // same person (DNI) can have policies spread across several producer codes; we
  // want them to show up for any admin who owns one of those policies.
  private clientVisibility(codeIds: number[]): Prisma.ClientWhereInput {
    return {
      OR: [
        { producerCodeId: { in: codeIds } },
        { policies: { some: { deletedAt: null, producerCodeId: { in: codeIds } } } },
      ],
    }
  }

  private buildAdminWhere(producerId: number, codeIds: number[], query: ListClientsDto): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { producerId, deletedAt: null }
    const and: Prisma.ClientWhereInput[] = [this.clientVisibility(codeIds)]

    const search = query.search?.trim()
    if (search) {
      const words = search.split(/\s+/).filter(Boolean)
      for (const word of words) {
        and.push({
          OR: [
            { firstName: { contains: word } },
            { lastName: { contains: word } },
            { email: { contains: word } },
            { dni: { contains: word } },
            { phone: { contains: word } },
            { policies: { some: { deletedAt: null, vehicle: { licensePlate: { contains: word } } } } },
          ],
        })
      }
    }

    if (query.riskType) {
      and.push({ policies: { some: { deletedAt: null, riskType: query.riskType } } })
    }

    const statusWhere = this.buildStatusWhere(query.status)
    if (statusWhere) and.push(statusWhere)

    if (and.length) where.AND = and
    return where
  }

  private buildStatusWhere(status?: ClientStatusFilter): Prisma.ClientWhereInput | null {
    if (!status) return null
    const now = new Date()
    const expiringLimit = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)

    switch (status) {
      case ClientStatusFilter.VIGENTE:
        return { policies: { some: inForcePolizaWhere(now) } }
      case ClientStatusFilter.POR_VENCER:
        return { policies: { some: expiringPolizaWhere(expiringLimit, now) } }
      case ClientStatusFilter.VENCIDA:
        // Has policies, but none currently in force.
        return {
          AND: [{ policies: { some: { deletedAt: null } } }, { policies: { none: inForcePolizaWhere(now) } }],
        }
      case ClientStatusFilter.SIN_POLIZAS:
        return { policies: { none: { deletedAt: null } } }
      default:
        return null
    }
  }

  private buildAdminOrderBy(sort?: ClientSort): Prisma.ClientOrderByWithRelationInput {
    switch (sort) {
      case ClientSort.NOMBRE_DESC:
        return { lastName: 'desc' }
      case ClientSort.RECIENTE:
        return { createdAt: 'desc' }
      case ClientSort.NOMBRE_ASC:
      default:
        return { lastName: 'asc' }
    }
  }

  async findOneForAdmin(id: number, producerId: number, codeIds: number[]) {
    const client = await this.prisma.client.findFirst({
      where: { id, producerId, deletedAt: null, ...this.clientVisibility(codeIds) },
      select: ADMIN_CLIENT_DETAIL_SELECT,
    })
    if (!client) throw new NotFoundException(`Client ${id} not found`)
    return { ...client, policies: client.policies.map(p => ({ ...p, validityStatus: validityStatus(p) })) }
  }

  async findPolizaById(id: number, clientId: number, producerId: number) {
    const poliza = await this.prisma.policy.findFirst({
      where: { id, clientId, producerId, deletedAt: null },
      select: POLIZA_DETAIL_SELECT,
    })

    if (!poliza) throw new NotFoundException(`Policy ${id} not found`)

    const { rawData, ...rest } = poliza
    return { ...rest, validityStatus: validityStatus(poliza), insuredItem: extractInsuredItem(rawData) }
  }

  async findCobranzasForAdmin(producerId: number, codeIds: number[], query: ListCobranzasDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const search = query.search?.trim()

    const and: Prisma.ClientWhereInput[] = [this.clientVisibility(codeIds)]
    const where: Prisma.ClientWhereInput = {
      producerId,
      deletedAt: null,
      policies: { some: { deletedAt: null, installments: { some: { deletedAt: null } } } },
      AND: and,
    }

    if (search) {
      const words = search.split(/\s+/).filter(Boolean)
      for (const word of words) {
        and.push({
          OR: [
            { firstName: { contains: word } },
            { lastName: { contains: word } },
            { email: { contains: word } },
            { dni: { contains: word } },
            { phone: { contains: word } },
            { policies: { some: { deletedAt: null, vehicle: { licensePlate: { contains: word } } } } },
          ],
        })
      }
    }

    const clients = await this.prisma.client.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dni: true,
        email: true,
        phone: true,
        policies: {
          where: { deletedAt: null },
          select: {
            riskType: true,
            vehicle: { select: { licensePlate: true } },
            installments: {
              where: { deletedAt: null },
              select: { amount: true, status: true, dueDate: true },
            },
          },
        },
      },
      orderBy: { lastName: 'asc' },
    })

    const enriched = clients.map(client => {
      const allCuotas = client.policies.flatMap(p => p.installments)
      const pending = allCuotas.filter(c => c.status === 'pending')
      const overdue = allCuotas.filter(c => c.status === 'overdue')
      const rejected = allCuotas.filter(c => c.status === 'rejected')
      const paid = allCuotas.filter(c => c.status === 'paid')
      // Negative-amount installments are insurer credits/adjustments, not debt — excluded from the owed total.
      const totalDebt = [...pending, ...overdue, ...rejected].reduce((sum, c) => sum + Math.max(0, Number(c.amount)), 0)

      const riskTypes: RiskType[] = []
      for (const p of client.policies) {
        if (!riskTypes.includes(p.riskType)) riskTypes.push(p.riskType)
      }
      const licensePlate = client.policies.find(p => p.vehicle?.licensePlate)?.vehicle?.licensePlate ?? null

      const overdueDates = overdue.map(c => c.dueDate).filter((d): d is Date => d != null)
      const oldestOverdueDate = overdueDates.length
        ? overdueDates.reduce((min, d) => (d < min ? d : min)).toISOString()
        : null

      return {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        dni: client.dni,
        email: client.email,
        phone: client.phone,
        riskTypes,
        licensePlate,
        pendingCount: pending.length,
        overdueCount: overdue.length,
        rejectedCount: rejected.length,
        paidCount: paid.length,
        totalDebt: totalDebt.toFixed(2),
        oldestOverdueDate,
      }
    })

    let filtered: typeof enriched
    switch (query.status) {
      case CollectionStatusFilter.VENCIDAS:
        filtered = enriched.filter(c => c.overdueCount > 0)
        break
      case CollectionStatusFilter.RECHAZADAS:
        filtered = enriched.filter(c => c.rejectedCount > 0)
        break
      case CollectionStatusFilter.PENDIENTES:
        filtered = enriched.filter(c => c.pendingCount > 0)
        break
      case CollectionStatusFilter.TODAS:
      default:
        filtered = enriched.filter(c => c.pendingCount + c.overdueCount + c.rejectedCount > 0)
        break
    }

    // Most urgent first: clients with the oldest overdue cuota, then by larger debt.
    filtered.sort((a, b) => {
      if (a.oldestOverdueDate && b.oldestOverdueDate) return a.oldestOverdueDate.localeCompare(b.oldestOverdueDate)
      if (a.oldestOverdueDate) return -1
      if (b.oldestOverdueDate) return 1
      return Number(b.totalDebt) - Number(a.totalDebt)
    })

    const total = filtered.length
    const data = filtered.slice((page - 1) * pageSize, page * pageSize)

    return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  async getCobranzasStats(producerId: number, codeIds: number[]) {
    const codeScope = { producerCodeId: { in: codeIds } }
    const baseCuota = { deletedAt: null, policy: { producerId, deletedAt: null, ...codeScope } }
    // Count clients who have a policy IN an accessible code with a cuota of the
    // given status. Scoping by the policy's code (not the client's) naturally
    // includes clients whose cartera spans several codes.
    const clientWithCuotaStatus = (status: 'pending' | 'overdue' | 'rejected'): Prisma.ClientWhereInput => ({
      producerId,
      deletedAt: null,
      policies: { some: { deletedAt: null, ...codeScope, installments: { some: { deletedAt: null, status } } } },
    })

    const [
      overdueInstallments,
      rejectedInstallments,
      pendingInstallments,
      clientsWithOverdue,
      clientsWithRejected,
      clientsWithPending,
      clientsWithDebt,
    ] = await this.prisma.$transaction([
      this.prisma.installment.count({ where: { ...baseCuota, status: 'overdue' } }),
      this.prisma.installment.count({ where: { ...baseCuota, status: 'rejected' } }),
      this.prisma.installment.count({ where: { ...baseCuota, status: 'pending' } }),
      this.prisma.client.count({ where: clientWithCuotaStatus('overdue') }),
      this.prisma.client.count({ where: clientWithCuotaStatus('rejected') }),
      this.prisma.client.count({ where: clientWithCuotaStatus('pending') }),
      this.prisma.client.count({
        where: {
          producerId,
          deletedAt: null,
          policies: {
            some: {
              deletedAt: null,
              ...codeScope,
              installments: { some: { deletedAt: null, status: { in: ['pending', 'overdue', 'rejected'] } } },
            },
          },
        },
      }),
    ])

    const deudaCuotas = await this.prisma.installment.findMany({
      where: { ...baseCuota, status: { in: ['pending', 'overdue', 'rejected'] } },
      select: { amount: true },
    })
    // Negative-amount installments are insurer credits/adjustments, not debt — excluded from the owed total.
    const totalDebt = deudaCuotas.reduce((sum, c) => sum + Math.max(0, Number(c.amount)), 0).toFixed(2)

    return {
      clientsWithDebt,
      clientsWithOverdue,
      clientsWithRejected,
      clientsWithPending,
      overdueInstallments,
      rejectedInstallments,
      pendingInstallments,
      totalDebt,
    }
  }
}
