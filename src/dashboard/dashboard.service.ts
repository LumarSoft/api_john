import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { expiringPolizaWhere, inForcePolizaWhere, notCancelledPolizaWhere } from '../common/poliza-vigencia'

const EXPIRING_WINDOW_DAYS = 30
const RENEWAL_MONTHS = 6
const SPANISH_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export interface RenewalPoint {
  month: string // YYYY-MM, used as a stable key
  label: string // short Spanish month label, e.g. "Mar"
  total: number // policies expiring that month
  premium: string // sum of their premium (premium at risk)
}

export interface DashboardData {
  kpis: {
    insuredClients: number
    newRequests: number
    overdueInstallments: number
    totalDebt: string
    openClaims: number
  }
  renewals: { premiumAtRisk: string; timeline: RenewalPoint[] }
  portfolio: { inForce: number; expiringSoon: number; expired: number }
  requestsByStatus: { new: number; contacted: number; closed: number }
  collections: { pending: number; overdue: number; rejected: number }
  claimsByStatus: { pending: number; inProgress: number; resolved: number }
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(producerId: number, codeIds: number[]): Promise<DashboardData> {
    const now = new Date()
    const expiringLimit = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000)
    const code = { producerCodeId: { in: codeIds } }
    // Lead-like entities can be unattributed to a code (anonymous web quotes/leads);
    // include those so KPIs match the Solicitudes list semantics.
    const codeOrNull = { OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }] }

    // Producer- + code-scoping shortcuts for each entity.
    const cotizacionLead = { deletedAt: null, quote: { producerId, deletedAt: null, ...codeOrNull } }
    const contactLead = { producerId, deletedAt: null, ...codeOrNull }
    const poliza = { producerId, deletedAt: null, ...code }
    // Cuotas of a policy Triunfo cancelled are not debt, as in cobranzas.
    const cuota = { deletedAt: null, policy: { producerId, deletedAt: null, ...code, ...notCancelledPolizaWhere() } }
    const siniestro = { producerId, deletedAt: null, ...code }

    const [
      asegurados,
      solicitudesNuevasCotizacion,
      solicitudesNuevasLead,
      cuotasVencidas,
      siniestrosAbiertos,
      vigentes,
      porVencer,
      vencidas,
      cotizacionNuevas,
      cotizacionContactadas,
      cotizacionCerradas,
      leadNuevas,
      leadContactadas,
      leadCerradas,
      cuotasPendientes,
      cuotasRechazadas,
      siniestrosPendiente,
      siniestrosEnProceso,
      siniestrosResuelto,
    ] = await this.prisma.$transaction([
      this.prisma.client.count({ where: { producerId, deletedAt: null, ...code } }),
      this.prisma.quoteRequest.count({ where: { ...cotizacionLead, status: 'NEW' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'NEW' } }),
      this.prisma.installment.count({ where: { ...cuota, status: 'overdue' } }),
      this.prisma.claim.count({ where: { ...siniestro, status: { in: ['pending', 'in_progress'] } } }),
      this.prisma.policy.count({ where: { AND: [poliza, inForcePolizaWhere(now)] } }),
      this.prisma.policy.count({ where: { AND: [poliza, expiringPolizaWhere(expiringLimit, now)] } }),
      this.prisma.policy.count({ where: { ...poliza, validTo: { lt: now } } }),
      this.prisma.quoteRequest.count({ where: { ...cotizacionLead, status: 'NEW' } }),
      this.prisma.quoteRequest.count({ where: { ...cotizacionLead, status: 'CONTACTED' } }),
      this.prisma.quoteRequest.count({ where: { ...cotizacionLead, status: 'CLOSED' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'NEW' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'CONTACTED' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'CLOSED' } }),
      this.prisma.installment.count({ where: { ...cuota, status: 'pending' } }),
      this.prisma.installment.count({ where: { ...cuota, status: 'rejected' } }),
      this.prisma.claim.count({ where: { ...siniestro, status: 'pending' } }),
      this.prisma.claim.count({ where: { ...siniestro, status: 'in_progress' } }),
      this.prisma.claim.count({ where: { ...siniestro, status: 'resolved' } }),
    ])

    const totalDebt = await this.computeMontoDeuda(producerId, codeIds)
    const renewals = await this.buildRenovaciones(producerId, codeIds, now)

    return {
      kpis: {
        insuredClients: asegurados,
        newRequests: solicitudesNuevasCotizacion + solicitudesNuevasLead,
        overdueInstallments: cuotasVencidas,
        totalDebt,
        openClaims: siniestrosAbiertos,
      },
      renewals,
      portfolio: { inForce: vigentes, expiringSoon: porVencer, expired: vencidas },
      requestsByStatus: {
        new: cotizacionNuevas + leadNuevas,
        contacted: cotizacionContactadas + leadContactadas,
        closed: cotizacionCerradas + leadCerradas,
      },
      collections: { pending: cuotasPendientes, overdue: cuotasVencidas, rejected: cuotasRechazadas },
      claimsByStatus: {
        pending: siniestrosPendiente,
        inProgress: siniestrosEnProceso,
        resolved: siniestrosResuelto,
      },
    }
  }

  // Total owed across pending/overdue/rejected cuotas. Negative amounts are insurer
  // credits/adjustments, not debt — excluded, mirroring the cobranzas stats logic.
  private async computeMontoDeuda(producerId: number, codeIds: number[]): Promise<string> {
    const cuotas = await this.prisma.installment.findMany({
      where: {
        deletedAt: null,
        policy: { producerId, deletedAt: null, producerCodeId: { in: codeIds }, ...notCancelledPolizaWhere() },
        status: { in: ['pending', 'overdue', 'rejected'] },
      },
      select: { amount: true },
    })
    return cuotas.reduce((sum, c) => sum + Math.max(0, Number(c.amount)), 0).toFixed(2)
  }

  // Policies expiring in each of the next RENEWAL_MONTHS months, with the premium
  // (prima) at risk per month. This is the broker's retention pipeline — who to
  // contact before the policy lapses. Buckets are built in JS so it stays DB-agnostic.
  private async buildRenovaciones(
    producerId: number,
    codeIds: number[],
    now: Date,
  ): Promise<{ premiumAtRisk: string; timeline: RenewalPoint[] }> {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + RENEWAL_MONTHS, 1)

    const polizas = await this.prisma.policy.findMany({
      where: {
        producerId,
        deletedAt: null,
        producerCodeId: { in: codeIds },
        validTo: { gte: start, lt: end },
      },
      select: { validTo: true, premium: true },
    })

    const timeline: RenewalPoint[] = []
    const primaByMonth = new Map<string, number>()
    for (let i = 0; i < RENEWAL_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = this.monthKey(d)
      primaByMonth.set(key, 0)
      timeline.push({ month: key, label: SPANISH_MONTHS[d.getMonth()], total: 0, premium: '0.00' })
    }

    let primaEnRiesgo = 0
    for (const poliza of polizas) {
      if (!poliza.validTo) continue
      const point = timeline.find(p => p.month === this.monthKey(poliza.validTo as Date))
      if (!point) continue
      const prima = Math.max(0, Number(poliza.premium ?? 0))
      point.total++
      primaByMonth.set(point.month, (primaByMonth.get(point.month) ?? 0) + prima)
      primaEnRiesgo += prima
    }

    for (const point of timeline) {
      point.premium = (primaByMonth.get(point.month) ?? 0).toFixed(2)
    }

    return { premiumAtRisk: primaEnRiesgo.toFixed(2), timeline }
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}
