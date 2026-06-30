import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { NovedadesService } from '../novedades/novedades.service'
import { CreateSiniestroDto } from './dto/create-siniestro.dto'
import { ListSiniestrosDto } from './dto/list-siniestros.dto'
import { UpdateSiniestroDto } from './dto/update-siniestro.dto'
import { toAdjuntoMeta } from './siniestro-upload.config'

const DEFAULT_PAGE_SIZE = 20

// Shape returned to the client — omits internal/tenant fields, includes basic poliza info.
const SINIESTRO_SELECT = {
  id: true,
  tipo: true,
  descripcion: true,
  fecha: true,
  estado: true,
  nroSiniestroCompania: true,
  adjuntos: true,
  createdAt: true,
  updatedAt: true,
  poliza: {
    select: {
      id: true,
      certificado: true,
      company: true,
      riskType: true,
    },
  },
} as const

// Admin shape — adds the client and the insured vehicle so the panel has
// everything needed to manually file the claim in Triunfo's web.
const ADMIN_SINIESTRO_SELECT = {
  ...SINIESTRO_SELECT,
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dni: true,
      email: true,
      phone: true,
    },
  },
  poliza: {
    select: {
      id: true,
      certificado: true,
      company: true,
      riskType: true,
      vehiculo: { select: { dominio: true, marca: true, modelo: true } },
    },
  },
} as const

@Injectable()
export class SiniestrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly novedades: NovedadesService,
  ) {}

  async create(clientId: number, producerId: number, dto: CreateSiniestroDto, files: Express.Multer.File[]) {
    // The policy must belong to the authenticated client in this tenant.
    const poliza = await this.prisma.poliza.findFirst({
      where: { id: dto.polizaId, clientId, producerId, deletedAt: null },
      select: { id: true, certificado: true, company: true, producerCodeId: true },
    })
    if (!poliza) {
      throw new NotFoundException(`Policy ${dto.polizaId} not found`)
    }

    const adjuntos = files.map(f => toAdjuntoMeta(f))

    const siniestro = await this.prisma.siniestro.create({
      data: {
        tipo: dto.tipo,
        descripcion: dto.descripcion,
        fecha: new Date(dto.fecha),
        estado: 'pendiente',
        adjuntos: adjuntos.length ? (adjuntos as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        clientId,
        polizaId: poliza.id,
        producerId,
        // Inherit the policy's producer code so admin scoping works.
        producerCodeId: poliza.producerCodeId,
      },
      select: SINIESTRO_SELECT,
    })

    await this.notifyAdvisor(siniestro.id, clientId, dto, poliza, adjuntos.length)

    const cliente = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { firstName: true, lastName: true },
    })
    await this.novedades.recordSiniestro(producerId, {
      siniestroId: siniestro.id,
      clientId,
      clienteNombre: cliente ? `${cliente.firstName} ${cliente.lastName}`.trim() : `Cliente #${clientId}`,
      descripcion: siniestro.descripcion,
      producerCodeId: poliza.producerCodeId,
    })

    return siniestro
  }

  findAll(clientId: number, producerId: number) {
    return this.prisma.siniestro.findMany({
      where: { clientId, producerId, deletedAt: null },
      select: SINIESTRO_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: number, clientId: number, producerId: number) {
    const siniestro = await this.prisma.siniestro.findFirst({
      where: { id, clientId, producerId, deletedAt: null },
      select: SINIESTRO_SELECT,
    })
    if (!siniestro) {
      throw new NotFoundException(`Siniestro ${id} not found`)
    }
    return siniestro
  }

  // ─── Admin (panel web) ─────────────────────────────────

  async findAllForAdmin(producerId: number, codeIds: number[], query: ListSiniestrosDto) {
    const page = query.page && query.page > 0 ? query.page : 1
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE
    const where = this.buildAdminWhere(producerId, codeIds, query)

    const [total, data] = await this.prisma.$transaction([
      this.prisma.siniestro.count({ where }),
      this.prisma.siniestro.findMany({
        where,
        select: ADMIN_SINIESTRO_SELECT,
        orderBy: { createdAt: 'desc' },
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

  async getAdminStats(producerId: number, codeIds: number[]) {
    const code = { producerCodeId: { in: codeIds } }
    const countByEstado = (estado: string) =>
      this.prisma.siniestro.count({ where: { producerId, deletedAt: null, ...code, estado } })

    const [pendientes, enProceso, resueltos, sinNroCompania] = await this.prisma.$transaction([
      countByEstado('pendiente'),
      countByEstado('en_proceso'),
      countByEstado('resuelto'),
      this.prisma.siniestro.count({ where: { producerId, deletedAt: null, ...code, nroSiniestroCompania: null } }),
    ])

    return { pendientes, enProceso, resueltos, sinNroCompania }
  }

  async findOneForAdmin(id: number, producerId: number, codeIds: number[]) {
    const siniestro = await this.prisma.siniestro.findFirst({
      where: { id, producerId, deletedAt: null, producerCodeId: { in: codeIds } },
      select: ADMIN_SINIESTRO_SELECT,
    })
    if (!siniestro) {
      throw new NotFoundException(`Siniestro ${id} not found`)
    }
    return siniestro
  }

  /** Admin progresses the claim and/or records the official Triunfo number after manual filing. */
  async updateForAdmin(id: number, producerId: number, codeIds: number[], dto: UpdateSiniestroDto) {
    if (dto.estado === undefined && dto.nroSiniestroCompania === undefined) {
      throw new BadRequestException('Nothing to update — send estado and/or nroSiniestroCompania')
    }

    await this.findOneForAdmin(id, producerId, codeIds)

    return this.prisma.siniestro.update({
      where: { id },
      data: {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.nroSiniestroCompania !== undefined && {
          nroSiniestroCompania: dto.nroSiniestroCompania.trim() || null,
        }),
      },
      select: ADMIN_SINIESTRO_SELECT,
    })
  }

  private buildAdminWhere(producerId: number, codeIds: number[], query: ListSiniestrosDto): Prisma.SiniestroWhereInput {
    const where: Prisma.SiniestroWhereInput = { producerId, deletedAt: null, producerCodeId: { in: codeIds } }

    if (query.estado) where.estado = query.estado

    if (query.search) {
      const search = query.search.trim()
      where.OR = [
        { client: { firstName: { contains: search } } },
        { client: { lastName: { contains: search } } },
        { client: { dni: { contains: search } } },
        { poliza: { certificado: { contains: search } } },
        { nroSiniestroCompania: { contains: search } },
      ]
    }

    return where
  }

  private async notifyAdvisor(
    siniestroId: number,
    clientId: number,
    dto: CreateSiniestroDto,
    poliza: { certificado: string; company: string },
    adjuntosCount: number,
  ): Promise<void> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { firstName: true, lastName: true, dni: true, email: true },
    })
    if (!client) return

    await this.mail.sendSiniestroNotification({
      siniestroId,
      tipo: dto.tipo,
      descripcion: dto.descripcion,
      fecha: new Date(dto.fecha),
      cliente: client,
      poliza: { certificado: poliza.certificado, company: poliza.company },
      adjuntosCount,
    })
  }
}
