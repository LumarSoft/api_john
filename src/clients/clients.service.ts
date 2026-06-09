import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

// Poliza shape returned for list — includes cuotas for payment summary, omits rawData
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

    // For auto policies: keep only the most recent per vehicle dominio.
    // Ordering by vigenciaDesde desc means the first occurrence per dominio is the newest.
    const seenDominio = new Set<string>()

    return polizas.filter(p => {
      const dominio = p.vehiculo?.dominio
      if (!dominio) return true // non-auto policies are always returned
      if (seenDominio.has(dominio)) return false
      seenDominio.add(dominio)
      return true
    })
  }

  async findPolizaById(id: number, clientId: number, producerId: number) {
    const poliza = await this.prisma.poliza.findFirst({
      where: { id, clientId, producerId, deletedAt: null },
      select: POLIZA_DETAIL_SELECT,
    })

    if (!poliza) {
      throw new NotFoundException(`Policy ${id} not found`)
    }

    return poliza
  }
}
