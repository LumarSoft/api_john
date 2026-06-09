import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { CreateSiniestroDto } from './dto/create-siniestro.dto'
import { toAdjuntoMeta } from './siniestro-upload.config'

// Shape returned to the client — omits internal/tenant fields, includes basic poliza info.
const SINIESTRO_SELECT = {
  id: true,
  tipo: true,
  descripcion: true,
  fecha: true,
  estado: true,
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

@Injectable()
export class SiniestrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(clientId: number, producerId: number, dto: CreateSiniestroDto, files: Express.Multer.File[]) {
    // The policy must belong to the authenticated client in this tenant.
    const poliza = await this.prisma.poliza.findFirst({
      where: { id: dto.polizaId, clientId, producerId, deletedAt: null },
      select: { id: true, certificado: true, company: true },
    })
    if (!poliza) {
      throw new NotFoundException(`Policy ${dto.polizaId} not found`)
    }

    const adjuntos = files.map(toAdjuntoMeta)

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
      },
      select: SINIESTRO_SELECT,
    })

    await this.notifyAdvisor(siniestro.id, clientId, dto, poliza, adjuntos.length)

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
