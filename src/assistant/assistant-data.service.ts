import { Injectable } from '@nestjs/common'
import { InstallmentStatus, Prisma, RiskType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  expiringPolizaWhere,
  inForcePolizaWhere,
  notCancelledPolizaWhere,
  validityStatus,
} from '../common/poliza-vigencia'
import { productNameOf } from '../common/poliza-detail'

const DAY_MS = 86_400_000
/** What a list tool hands the model at most: enough to answer, little enough to stay fast and cheap. */
const LIST_LIMIT = 15

const RISK_LABELS: Record<string, string> = {
  auto: 'auto',
  moto: 'moto',
  home: 'hogar',
  life: 'vida',
  commercial: 'comercio',
  other: 'otro',
}

const VALIDITY_LABELS: Record<string, string> = {
  vigente: 'vigente',
  proxima: 'todavía no empezó',
  vencida: 'vencida',
  anulada: 'anulada',
}

const INSTALLMENT_LABELS: Record<string, string> = {
  pending: 'a vencer',
  overdue: 'vencida',
  rejected: 'rechazada',
  paid: 'pagada',
}

const CLAIM_LABELS: Record<string, string> = { pending: 'pendiente', in_progress: 'en trámite', resolved: 'resuelto' }

/** Who the user may see: as Asegurados, a client of one of their codes or with a policy in one. */
function clientVisibility(codeIds: number[]): Prisma.ClientWhereInput {
  return {
    OR: [
      { producerCodeId: { in: codeIds } },
      { policies: { some: { deletedAt: null, producerCodeId: { in: codeIds } } } },
    ],
  }
}

/**
 * The read-only questions the AI assistant can ask the portfolio, always
 * inside the codes the user sees in the panel. Each answer is small, flat and
 * in Spanish, for the model to read and retell.
 */
@Injectable()
export class AssistantDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** Clients by name, DNI/CUIT, phone, e-mail, plate or policy number: up to 8, with their policies. */
  async searchClients(producerId: number, codeIds: number[], query: string) {
    const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 5)
    if (!words.length) return { resultados: [] }
    const clients = await this.prisma.client.findMany({
      where: {
        producerId,
        deletedAt: null,
        AND: [
          clientVisibility(codeIds),
          ...words.map(word => ({
            OR: [
              { firstName: { contains: word } },
              { lastName: { contains: word } },
              { dni: { contains: word } },
              { phone: { contains: word } },
              { email: { contains: word } },
              {
                policies: {
                  some: {
                    deletedAt: null,
                    OR: [{ certificateNumber: { contains: word } }, { vehicle: { licensePlate: { contains: word } } }],
                  },
                },
              },
            ],
          })),
        ],
      },
      take: 8,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dni: true,
        phone: true,
        policies: {
          where: { deletedAt: null, producerCodeId: { in: codeIds } },
          orderBy: { validTo: 'desc' },
          take: 6,
          select: {
            certificateNumber: true,
            riskType: true,
            lastMovement: true,
            validFrom: true,
            validTo: true,
            rawData: true,
            vehicle: { select: { licensePlate: true, brand: true, model: true, year: true } },
          },
        },
      },
    })
    return {
      resultados: clients.map(c => ({
        id: c.id,
        nombre: fullName(c.firstName, c.lastName),
        dni: c.dni,
        telefono: c.phone,
        polizas: c.policies.map(p => ({
          poliza: p.certificateNumber,
          bien: itemOf(p),
          estado: VALIDITY_LABELS[validityStatus(p)],
          vence: day(p.validTo),
        })),
      })),
    }
  }

  /** One client's file: contact, policies with coverage and validity, unpaid installments and claims. */
  async clientFile(producerId: number, codeIds: number[], clientId: number) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, producerId, deletedAt: null, ...clientVisibility(codeIds) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dni: true,
        phone: true,
        email: true,
        city: true,
        producerCode: { select: { code: true, holderName: true } },
        policies: {
          where: { deletedAt: null, producerCodeId: { in: codeIds } },
          orderBy: { validTo: 'desc' },
          take: 20,
          select: {
            certificateNumber: true,
            riskType: true,
            lastMovement: true,
            validFrom: true,
            validTo: true,
            premium: true,
            paymentMethod: true,
            rawData: true,
            producerCode: { select: { code: true } },
            vehicle: { select: { licensePlate: true, brand: true, model: true, year: true, coverage: true } },
            installments: {
              where: { deletedAt: null, status: { not: InstallmentStatus.paid } },
              orderBy: { number: 'asc' },
              select: { number: true, amount: true, dueDate: true, status: true },
            },
            claims: {
              where: { deletedAt: null },
              orderBy: { occurredAt: 'desc' },
              take: 5,
              select: { type: true, occurredAt: true, status: true, insurerClaimNumber: true },
            },
          },
        },
      },
    })
    if (!client) return { error: 'No hay un asegurado con ese id entre los que puede ver este usuario.' }
    return {
      id: client.id,
      nombre: fullName(client.firstName, client.lastName),
      dni: client.dni,
      telefono: client.phone,
      email: client.email,
      localidad: client.city,
      productor: client.producerCode
        ? `${client.producerCode.code} · ${client.producerCode.holderName ?? ''}`.trim()
        : null,
      polizas: client.policies.map(p => ({
        poliza: p.certificateNumber,
        tipo: RISK_LABELS[p.riskType] ?? p.riskType,
        bien: itemOf(p),
        cobertura: p.vehicle?.coverage ?? null,
        estado: VALIDITY_LABELS[validityStatus(p)],
        desde: day(p.validFrom),
        hasta: day(p.validTo),
        ultimoMovimiento: p.lastMovement,
        premio: p.premium ? Number(p.premium) : null,
        medioDePago: p.paymentMethod,
        codigo: p.producerCode?.code ?? null,
        cuotasImpagas: p.installments.map(i => ({
          cuota: i.number,
          importe: Number(i.amount),
          vence: day(i.dueDate),
          estado: INSTALLMENT_LABELS[i.status] ?? i.status,
        })),
        siniestros: p.claims.map(c => ({
          tipo: c.type,
          fecha: day(c.occurredAt),
          estado: CLAIM_LABELS[c.status] ?? c.status,
          numeroEnLaCompania: c.insurerClaimNumber,
        })),
      })),
    }
  }

  /** Policies in force that end within `days`, soonest first. */
  async expiringPolicies(producerId: number, codeIds: number[], days: number, riskType?: string, now = new Date()) {
    const until = new Date(now.getTime() + clamp(days, 1, 90) * DAY_MS)
    const where: Prisma.PolicyWhereInput = {
      producerId,
      producerCodeId: { in: codeIds },
      ...expiringPolizaWhere(until, now),
      ...(riskType && riskType in RISK_LABELS ? { riskType: riskType as RiskType } : {}),
    }
    const [total, policies] = await Promise.all([
      this.prisma.policy.count({ where }),
      this.prisma.policy.findMany({
        where,
        orderBy: { validTo: 'asc' },
        take: LIST_LIMIT,
        select: {
          certificateNumber: true,
          riskType: true,
          validTo: true,
          rawData: true,
          client: { select: { id: true, firstName: true, lastName: true } },
          vehicle: { select: { licensePlate: true, brand: true, model: true, year: true } },
        },
      }),
    ])
    return {
      total,
      mostrando: policies.length,
      polizas: policies.map(p => ({
        asegurado: { id: p.client.id, nombre: fullName(p.client.firstName, p.client.lastName) },
        poliza: p.certificateNumber,
        bien: itemOf(p),
        vence: day(p.validTo),
      })),
    }
  }

  /** Clients with unpaid installments of policies Triunfo has not cancelled, the oldest due first. */
  async unpaidInstallments(producerId: number, codeIds: number[], status: string) {
    const statuses =
      status === 'rejected'
        ? [InstallmentStatus.rejected]
        : status === 'overdue'
          ? [InstallmentStatus.overdue]
          : status === 'pending'
            ? [InstallmentStatus.pending]
            : [InstallmentStatus.overdue, InstallmentStatus.rejected]
    const where: Prisma.InstallmentWhereInput = {
      deletedAt: null,
      status: { in: statuses },
      policy: { producerId, deletedAt: null, producerCodeId: { in: codeIds }, ...notCancelledPolizaWhere() },
    }
    const [total, installments] = await Promise.all([
      this.prisma.installment.count({ where }),
      this.prisma.installment.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
        select: {
          number: true,
          amount: true,
          dueDate: true,
          status: true,
          policy: {
            select: {
              certificateNumber: true,
              riskType: true,
              rawData: true,
              client: { select: { id: true, firstName: true, lastName: true } },
              vehicle: { select: { licensePlate: true, brand: true, model: true, year: true } },
            },
          },
        },
      }),
    ])
    return {
      total,
      mostrando: installments.length,
      cuotas: installments.map(i => ({
        asegurado: { id: i.policy.client.id, nombre: fullName(i.policy.client.firstName, i.policy.client.lastName) },
        poliza: i.policy.certificateNumber,
        bien: itemOf(i.policy),
        cuota: i.number,
        importe: Number(i.amount),
        vence: day(i.dueDate),
        estado: INSTALLMENT_LABELS[i.status] ?? i.status,
      })),
    }
  }

  /** The portfolio in numbers: clients, policies in force by kind, what ends soon, unpaid and open claims. */
  async portfolioSummary(producerId: number, codeIds: number[], now = new Date()) {
    const policyScope: Prisma.PolicyWhereInput = { producerId, producerCodeId: { in: codeIds } }
    const [clients, inForce, expiring, overdue, rejected, openClaims] = await Promise.all([
      this.prisma.client.count({ where: { producerId, deletedAt: null, ...clientVisibility(codeIds) } }),
      this.prisma.policy.groupBy({
        by: ['riskType'],
        where: { ...policyScope, ...inForcePolizaWhere(now) },
        _count: true,
      }),
      this.prisma.policy.count({
        where: { ...policyScope, ...expiringPolizaWhere(new Date(now.getTime() + 30 * DAY_MS), now) },
      }),
      this.prisma.installment.count({
        where: {
          deletedAt: null,
          status: InstallmentStatus.overdue,
          policy: { ...policyScope, deletedAt: null, ...notCancelledPolizaWhere() },
        },
      }),
      this.prisma.installment.count({
        where: {
          deletedAt: null,
          status: InstallmentStatus.rejected,
          policy: { ...policyScope, deletedAt: null, ...notCancelledPolizaWhere() },
        },
      }),
      this.prisma.claim.count({
        where: {
          producerId,
          deletedAt: null,
          status: { not: 'resolved' },
          policy: { producerCodeId: { in: codeIds } },
        },
      }),
    ])
    return {
      asegurados: clients,
      polizasVigentes: Object.fromEntries(inForce.map(g => [RISK_LABELS[g.riskType] ?? g.riskType, g._count])),
      vencenEnLos30Dias: expiring,
      cuotasVencidasImpagas: overdue,
      cuotasRechazadas: rejected,
      siniestrosAbiertos: openClaims,
    }
  }
}

function fullName(firstName: string | null, lastName: string | null): string {
  return titleCase([firstName, lastName].filter(Boolean).join(' ')) || 'Sin nombre'
}

function itemOf(p: {
  riskType: string
  rawData: unknown
  vehicle?: { licensePlate: string | null; brand: string | null; model: string | null; year: number | null } | null
}): string {
  if (p.vehicle) {
    const name = titleCase([p.vehicle.brand, p.vehicle.model, p.vehicle.year].filter(Boolean).join(' '))
    return [name, p.vehicle.licensePlate].filter(Boolean).join(' · ') || 'vehículo'
  }
  return productNameOf(p.riskType, p.rawData) || RISK_LABELS[p.riskType] || p.riskType
}

/** dd/mm/yyyy of a date-only value (stored at UTC midnight). */
function day(date: Date | null): string | null {
  if (!date) return null
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase())
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}
