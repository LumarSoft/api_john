import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const EXPIRING_WINDOW_DAYS = 30
const RENEWAL_MONTHS = 6
const SPANISH_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export interface RenovacionPoint {
  month: string // YYYY-MM, used as a stable key
  label: string // short Spanish month label, e.g. "Mar"
  total: number // policies expiring that month
  prima: string // sum of their premium (prima en riesgo)
}

export interface DashboardData {
  kpis: {
    asegurados: number
    solicitudesNuevas: number
    cuotasVencidas: number
    montoDeudaTotal: string
    siniestrosAbiertos: number
  }
  renovaciones: { primaEnRiesgo: string; timeline: RenovacionPoint[] }
  cartera: { vigentes: number; porVencer: number; vencidas: number }
  solicitudesPorEstado: { nuevas: number; contactadas: number; cerradas: number }
  cobranzas: { pendientes: number; vencidas: number; rechazadas: number }
  siniestrosPorEstado: { pendiente: number; enProceso: number; resuelto: number }
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
    const cotizacionLead = { deletedAt: null, cotizacion: { producerId, deletedAt: null, ...codeOrNull } }
    const contactLead = { producerId, deletedAt: null, ...codeOrNull }
    const poliza = { producerId, deletedAt: null, ...code }
    const cuota = { deletedAt: null, poliza: { producerId, deletedAt: null, ...code } }
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
      this.prisma.solicitud.count({ where: { ...cotizacionLead, status: 'NEW' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'NEW' } }),
      this.prisma.cuota.count({ where: { ...cuota, status: 'overdue' } }),
      this.prisma.siniestro.count({ where: { ...siniestro, estado: { in: ['pendiente', 'en_proceso'] } } }),
      this.prisma.poliza.count({ where: { ...poliza, vigenciaHasta: { gte: now } } }),
      this.prisma.poliza.count({ where: { ...poliza, vigenciaHasta: { gte: now, lte: expiringLimit } } }),
      this.prisma.poliza.count({ where: { ...poliza, vigenciaHasta: { lt: now } } }),
      this.prisma.solicitud.count({ where: { ...cotizacionLead, status: 'NEW' } }),
      this.prisma.solicitud.count({ where: { ...cotizacionLead, status: 'CONTACTED' } }),
      this.prisma.solicitud.count({ where: { ...cotizacionLead, status: 'CLOSED' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'NEW' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'CONTACTED' } }),
      this.prisma.contactLead.count({ where: { ...contactLead, status: 'CLOSED' } }),
      this.prisma.cuota.count({ where: { ...cuota, status: 'pending' } }),
      this.prisma.cuota.count({ where: { ...cuota, status: 'rejected' } }),
      this.prisma.siniestro.count({ where: { ...siniestro, estado: 'pendiente' } }),
      this.prisma.siniestro.count({ where: { ...siniestro, estado: 'en_proceso' } }),
      this.prisma.siniestro.count({ where: { ...siniestro, estado: 'resuelto' } }),
    ])

    const montoDeudaTotal = await this.computeMontoDeuda(producerId, codeIds)
    const renovaciones = await this.buildRenovaciones(producerId, codeIds, now)

    return {
      kpis: {
        asegurados,
        solicitudesNuevas: solicitudesNuevasCotizacion + solicitudesNuevasLead,
        cuotasVencidas,
        montoDeudaTotal,
        siniestrosAbiertos,
      },
      renovaciones,
      cartera: { vigentes, porVencer, vencidas },
      solicitudesPorEstado: {
        nuevas: cotizacionNuevas + leadNuevas,
        contactadas: cotizacionContactadas + leadContactadas,
        cerradas: cotizacionCerradas + leadCerradas,
      },
      cobranzas: { pendientes: cuotasPendientes, vencidas: cuotasVencidas, rechazadas: cuotasRechazadas },
      siniestrosPorEstado: {
        pendiente: siniestrosPendiente,
        enProceso: siniestrosEnProceso,
        resuelto: siniestrosResuelto,
      },
    }
  }

  // Total owed across pending/overdue/rejected cuotas. Negative amounts are insurer
  // credits/adjustments, not debt — excluded, mirroring the cobranzas stats logic.
  private async computeMontoDeuda(producerId: number, codeIds: number[]): Promise<string> {
    const cuotas = await this.prisma.cuota.findMany({
      where: {
        deletedAt: null,
        poliza: { producerId, deletedAt: null, producerCodeId: { in: codeIds } },
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
  ): Promise<{ primaEnRiesgo: string; timeline: RenovacionPoint[] }> {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + RENEWAL_MONTHS, 1)

    const polizas = await this.prisma.poliza.findMany({
      where: {
        producerId,
        deletedAt: null,
        producerCodeId: { in: codeIds },
        vigenciaHasta: { gte: start, lt: end },
      },
      select: { vigenciaHasta: true, premio: true },
    })

    const timeline: RenovacionPoint[] = []
    const primaByMonth = new Map<string, number>()
    for (let i = 0; i < RENEWAL_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = this.monthKey(d)
      primaByMonth.set(key, 0)
      timeline.push({ month: key, label: SPANISH_MONTHS[d.getMonth()], total: 0, prima: '0.00' })
    }

    let primaEnRiesgo = 0
    for (const poliza of polizas) {
      if (!poliza.vigenciaHasta) continue
      const point = timeline.find(p => p.month === this.monthKey(poliza.vigenciaHasta as Date))
      if (!point) continue
      const prima = Math.max(0, Number(poliza.premio ?? 0))
      point.total++
      primaByMonth.set(point.month, (primaByMonth.get(point.month) ?? 0) + prima)
      primaEnRiesgo += prima
    }

    for (const point of timeline) {
      point.prima = (primaByMonth.get(point.month) ?? 0).toFixed(2)
    }

    return { primaEnRiesgo: primaEnRiesgo.toFixed(2), timeline }
  }

  private monthKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}
