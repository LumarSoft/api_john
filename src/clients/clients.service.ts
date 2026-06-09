import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ClientEstadoFilter, ClientSort, ListClientsDto } from './dto/list-clients.dto'

// ─── Bien data extracted from rawData.SDTOtrosRiesgosDatos ───────────────────
// Present on non-vehicle policies (life, home, commercial, other).
// Never sent on vehicle policies (they use the Vehiculo relation instead).

export interface BienCobertura {
  riesgo: string
  cobertura: string
  sumaAsegurada: string
}

export interface BienData {
  descripcion: string | null
  coberturas: BienCobertura[]
}

function extractBien(rawData: Prisma.JsonValue): BienData | null {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const raw = rawData as Record<string, Prisma.JsonValue>
  const otros = raw.SDTOtrosRiesgosDatos
  if (!otros || typeof otros !== 'object' || Array.isArray(otros)) return null
  const o = otros as Record<string, Prisma.JsonValue>

  const descripcion =
    typeof o.ObjetoSeguroDescripcion === 'string' && o.ObjetoSeguroDescripcion.trim()
      ? o.ObjetoSeguroDescripcion.trim()
      : null

  const coberturas: BienCobertura[] = []
  if (Array.isArray(o.SDTRiesgosCoberturas)) {
    for (const c of o.SDTRiesgosCoberturas) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const cob = c as Record<string, Prisma.JsonValue>
        if (typeof cob.Riesgo === 'string' && typeof cob.Cobertura === 'string') {
          coberturas.push({
            riesgo: cob.Riesgo,
            cobertura: cob.Cobertura,
            sumaAsegurada: typeof cob.SumaAsegurada === 'string' ? cob.SumaAsegurada : '0.00',
          })
        }
      }
    }
  }

  if (!descripcion && coberturas.length === 0) return null
  return { descripcion, coberturas }
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
  polizas: {
    where: { deletedAt: null },
    select: {
      id: true,
      certificado: true,
      riskType: true,
      status: true,
      vigenciaDesde: true,
      vigenciaHasta: true,
      premio: true,
      vehiculo: {
        select: {
          id: true,
          dominio: true,
          marca: true,
          modelo: true,
          subModelo: true,
          anio: true,
          cobertura: true,
          sumaAsegurada: true,
        },
      },
    },
    orderBy: { vigenciaHasta: 'asc' as const },
  },
} as const

const ADMIN_CLIENT_DETAIL_SELECT = {
  ...ADMIN_CLIENT_SELECT,
  polizas: {
    where: { deletedAt: null },
    select: {
      id: true,
      certificado: true,
      suplemento: true,
      company: true,
      riskType: true,
      status: true,
      vigenciaDesde: true,
      vigenciaHasta: true,
      premio: true,
      paymentMethod: true,
      vehiculo: {
        select: {
          id: true,
          dominio: true,
          marca: true,
          modelo: true,
          subModelo: true,
          anio: true,
          tipo: true,
          uso: true,
          cobertura: true,
          sumaAsegurada: true,
          ceroKm: true,
          chasis: true,
          motor: true,
        },
      },
      cuotas: {
        where: { deletedAt: null },
        select: {
          id: true,
          numeroCuota: true,
          amount: true,
          dueDate: true,
          status: true,
        },
        orderBy: { numeroCuota: 'asc' as const },
      },
    },
    orderBy: { vigenciaHasta: 'asc' as const },
  },
} as const

// Poliza shape fetched from DB — rawData is extracted server-side and dropped from the response
const POLIZA_LIST_SELECT = {
  id: true,
  certificado: true,
  suplemento: true,
  company: true,
  riskType: true,
  status: true,
  vigenciaDesde: true,
  vigenciaHasta: true,
  premio: true,
  paymentMethod: true,
  createdAt: true,
  rawData: true,
  vehiculo: {
    select: {
      id: true,
      dominio: true,
      marca: true,
      modelo: true,
      subModelo: true,
      anio: true,
      tipo: true,
      uso: true,
      cobertura: true,
      sumaAsegurada: true,
      ceroKm: true,
      chasis: true,
      motor: true,
    },
  },
  cuotas: {
    where: { deletedAt: null },
    select: {
      id: true,
      numeroCuota: true,
      amount: true,
      dueDate: true,
      status: true,
    },
    orderBy: { numeroCuota: 'asc' as const },
  },
} as const

// Full detail shape — includes cuotas, still omits rawData and password fields
const POLIZA_DETAIL_SELECT = {
  ...POLIZA_LIST_SELECT,
  cuotas: {
    where: { deletedAt: null },
    select: {
      id: true,
      numeroCuota: true,
      amount: true,
      dueDate: true,
      status: true,
    },
    orderBy: { numeroCuota: 'asc' as const },
  },
} as const

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findPolizas(clientId: number, producerId: number) {
    const polizas = await this.prisma.poliza.findMany({
      where: { clientId, producerId, deletedAt: null },
      select: POLIZA_LIST_SELECT,
      orderBy: { vigenciaDesde: 'desc' },
    })

    // For vehicle policies: keep only the most recent per dominio (dedup by plate).
    const seenDominio = new Set<string>()

    return polizas
      .filter(p => {
        const dominio = p.vehiculo?.dominio
        if (!dominio) return true
        if (seenDominio.has(dominio)) return false
        seenDominio.add(dominio)
        return true
      })
      .map(({ rawData, ...rest }) => ({ ...rest, bien: extractBien(rawData) }))
  }

  async findAllForAdmin(producerId: number, query: ListClientsDto) {
    const page = query.page && query.page > 0 ? query.page : 1
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE
    const where = this.buildAdminWhere(producerId, query)

    const [total, data] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        select: ADMIN_CLIENT_SELECT,
        orderBy: this.buildAdminOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async getAdminStats(producerId: number) {
    const now = new Date()
    const expiringLimit = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)
    const activePoliza = { producerId, deletedAt: null }

    const [totalClients, vigentes, porVencer, vencidas, cuotasVencidas] = await this.prisma.$transaction([
      this.prisma.client.count({ where: { producerId, deletedAt: null } }),
      this.prisma.poliza.count({ where: { ...activePoliza, vigenciaHasta: { gte: now } } }),
      this.prisma.poliza.count({ where: { ...activePoliza, vigenciaHasta: { gte: now, lte: expiringLimit } } }),
      this.prisma.poliza.count({ where: { ...activePoliza, vigenciaHasta: { lt: now } } }),
      this.prisma.cuota.count({
        where: { deletedAt: null, status: 'overdue', poliza: { producerId, deletedAt: null } },
      }),
    ])

    return { totalClients, vigentes, porVencer, vencidas, cuotasVencidas }
  }

  private buildAdminWhere(producerId: number, query: ListClientsDto): Prisma.ClientWhereInput {
    const where: Prisma.ClientWhereInput = { producerId, deletedAt: null }
    const and: Prisma.ClientWhereInput[] = []

    const search = query.search?.trim()
    if (search) {
      and.push({
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { email: { contains: search } },
          { dni: { contains: search } },
          { phone: { contains: search } },
          { polizas: { some: { deletedAt: null, vehiculo: { dominio: { contains: search } } } } },
        ],
      })
    }

    if (query.riskType) {
      and.push({ polizas: { some: { deletedAt: null, riskType: query.riskType } } })
    }

    const estadoWhere = this.buildEstadoWhere(query.estado)
    if (estadoWhere) and.push(estadoWhere)

    if (and.length) where.AND = and
    return where
  }

  private buildEstadoWhere(estado?: ClientEstadoFilter): Prisma.ClientWhereInput | null {
    if (!estado) return null
    const now = new Date()
    const expiringLimit = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)

    switch (estado) {
      case ClientEstadoFilter.VIGENTE:
        return { polizas: { some: { deletedAt: null, vigenciaHasta: { gte: now } } } }
      case ClientEstadoFilter.POR_VENCER:
        return { polizas: { some: { deletedAt: null, vigenciaHasta: { gte: now, lte: expiringLimit } } } }
      case ClientEstadoFilter.VENCIDA:
        // Has policies, but none currently in force.
        return {
          AND: [
            { polizas: { some: { deletedAt: null } } },
            { polizas: { none: { deletedAt: null, vigenciaHasta: { gte: now } } } },
          ],
        }
      case ClientEstadoFilter.SIN_POLIZAS:
        return { polizas: { none: { deletedAt: null } } }
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

  async findOneForAdmin(id: number, producerId: number) {
    const client = await this.prisma.client.findFirst({
      where: { id, producerId, deletedAt: null },
      select: ADMIN_CLIENT_DETAIL_SELECT,
    })
    if (!client) throw new NotFoundException(`Client ${id} not found`)
    return client
  }

  async findPolizaById(id: number, clientId: number, producerId: number) {
    const poliza = await this.prisma.poliza.findFirst({
      where: { id, clientId, producerId, deletedAt: null },
      select: POLIZA_DETAIL_SELECT,
    })

    if (!poliza) throw new NotFoundException(`Policy ${id} not found`)

    const { rawData, ...rest } = poliza
    return { ...rest, bien: extractBien(rawData) }
  }
}
