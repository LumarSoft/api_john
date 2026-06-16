import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { MailService } from '../mail/mail.service'
import { SaveMessageDto } from './dto/save-message.dto'
import { IdentifyClientDto } from './dto/identify-client.dto'
import { CreateBotSiniestroDto } from './dto/create-bot-siniestro.dto'

const CLIENT_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  dni: true,
  email: true,
  phone: true,
  city: true,
} as const

const POLIZA_SUMMARY_SELECT = {
  id: true,
  certificado: true,
  company: true,
  riskType: true,
  status: true,
  vigenciaDesde: true,
  vigenciaHasta: true,
  paymentMethod: true,
  vehiculo: {
    select: {
      dominio: true,
      marca: true,
      modelo: true,
      anio: true,
      cobertura: true,
    },
  },
} as const

@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly mail: MailService,
  ) {}

  /** Resolves the producer (tenant) behind a Meta phone number ID. */
  async getContext(phoneNumberId: string) {
    const phoneNumber = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId, isActive: true, deletedAt: null },
      select: {
        producer: { select: { id: true, name: true, slug: true, systemPrompt: true, isActive: true } },
      },
    })
    if (!phoneNumber || !phoneNumber.producer.isActive) {
      throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    }

    const { id, name, slug, systemPrompt } = phoneNumber.producer
    return { producerId: id, producerName: name, producerSlug: slug, systemPrompt }
  }

  /** Finds or creates the conversation for a WhatsApp user and returns its recent history. */
  async getOrCreateConversation(phoneNumberId: string, waId: string) {
    const { producerId } = await this.getContext(phoneNumberId)

    let conversation = await this.prisma.conversation.findFirst({
      where: { waId, producerId, deletedAt: null },
      select: { id: true, client: { select: CLIENT_SUMMARY_SELECT } },
    })

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { waId, producerId },
        select: { id: true, client: { select: CLIENT_SUMMARY_SELECT } },
      })
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, role: true, content: true, createdAt: true },
    })

    return {
      conversationId: conversation.id,
      client: conversation.client,
      messages: messages.reverse(),
    }
  }

  async saveMessage(conversationId: number, dto: SaveMessageDto) {
    await this.findConversation(conversationId)

    return this.prisma.message.create({
      data: { conversationId, role: dto.role, content: dto.content },
      select: { id: true, role: true, content: true, createdAt: true },
    })
  }

  /**
   * Links the conversation to a Client found by DNI or license plate.
   * This is what unlocks the client-only endpoints (polizas, cuotas, documentos, siniestros).
   */
  async identifyClient(conversationId: number, dto: IdentifyClientDto) {
    const conversation = await this.findConversation(conversationId)

    if (!dto.dni && !dto.plate) {
      throw new BadRequestException('Either dni or plate is required')
    }

    let client: { id: number } | null = null

    if (dto.dni) {
      client = await this.prisma.client.findFirst({
        where: { dni: dto.dni.trim(), producerId: conversation.producerId, deletedAt: null },
        select: { id: true },
      })
    }

    if (!client && dto.plate) {
      const plate = dto.plate.replace(/[\s-]/g, '').toUpperCase()
      const poliza = await this.prisma.poliza.findFirst({
        where: {
          producerId: conversation.producerId,
          deletedAt: null,
          vehiculo: { dominio: plate, deletedAt: null },
        },
        select: { clientId: true },
      })
      if (poliza) client = { id: poliza.clientId }
    }

    if (!client) {
      throw new NotFoundException('No client found for the given dni/plate')
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { clientId: client.id },
      select: { client: { select: CLIENT_SUMMARY_SELECT } },
    })

    const polizasCount = await this.prisma.poliza.count({
      where: { clientId: client.id, deletedAt: null },
    })

    return { client: updated.client, polizasCount }
  }

  async getPolizas(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    return this.prisma.poliza.findMany({
      where: { clientId, producerId, deletedAt: null },
      orderBy: { vigenciaHasta: 'desc' },
      select: POLIZA_SUMMARY_SELECT,
    })
  }

  /**
   * Account status across all the client's policies: unpaid installments
   * (pending / overdue / rejected) plus a paid count per policy.
   */
  async getEstadoCuenta(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const polizas = await this.prisma.poliza.findMany({
      where: { clientId, producerId, deletedAt: null },
      select: {
        id: true,
        certificado: true,
        riskType: true,
        status: true,
        paymentMethod: true,
        vehiculo: { select: { dominio: true, marca: true, modelo: true } },
        cuotas: {
          where: { deletedAt: null },
          orderBy: { numeroCuota: 'asc' },
          select: { numeroCuota: true, amount: true, dueDate: true, status: true },
        },
      },
    })

    return polizas.map(poliza => {
      const { cuotas, ...rest } = poliza
      return {
        ...rest,
        cuotasPagas: cuotas.filter(c => c.status === 'paid').length,
        cuotasImpagas: cuotas.filter(c => c.status !== 'paid'),
        tieneRechazos: cuotas.some(c => c.status === 'rejected'),
      }
    })
  }

  /** Documents of a policy (tarjeta de circulación, certificado, cupón) fetched live from Triunfo. */
  async getDocumentos(conversationId: number, polizaId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    const poliza = await this.prisma.poliza.findFirst({
      where: { id: polizaId, clientId, producerId, deletedAt: null },
      select: { certificado: true },
    })
    if (!poliza) throw new NotFoundException(`Policy ${polizaId} not found`)

    const documentos = await this.triunfo.getDocumentos(poliza.certificado)
    return documentos.map(doc => ({ codigo: doc.Codigo, nombre: doc.Nombre, url: doc.Url }))
  }

  async getSiniestros(conversationId: number) {
    const { clientId, producerId } = await this.requireIdentifiedClient(conversationId)

    return this.prisma.siniestro.findMany({
      where: { clientId, producerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipo: true,
        descripcion: true,
        fecha: true,
        estado: true,
        nroSiniestroCompania: true,
        createdAt: true,
        poliza: { select: { id: true, certificado: true, riskType: true } },
      },
    })
  }

  async createSiniestro(conversationId: number, dto: CreateBotSiniestroDto) {
    const { clientId, producerId, client } = await this.requireIdentifiedClient(conversationId)

    const poliza = await this.prisma.poliza.findFirst({
      where: { id: dto.polizaId, clientId, producerId, deletedAt: null },
      select: { id: true, certificado: true, company: true },
    })
    if (!poliza) throw new NotFoundException(`Policy ${dto.polizaId} not found`)

    const siniestro = await this.prisma.siniestro.create({
      data: {
        tipo: dto.tipo,
        descripcion: dto.descripcion,
        fecha: new Date(dto.fecha),
        estado: 'pendiente',
        clientId,
        polizaId: poliza.id,
        producerId,
      },
      select: {
        id: true,
        tipo: true,
        descripcion: true,
        fecha: true,
        estado: true,
        nroSiniestroCompania: true,
        createdAt: true,
        poliza: { select: { id: true, certificado: true, riskType: true } },
      },
    })

    // Never blocks the response — MailService swallows its own errors.
    await this.mail.sendSiniestroNotification({
      siniestroId: siniestro.id,
      tipo: siniestro.tipo,
      descripcion: siniestro.descripcion,
      fecha: siniestro.fecha,
      cliente: { firstName: client.firstName, lastName: client.lastName, dni: client.dni, email: client.email },
      poliza: { certificado: poliza.certificado, company: poliza.company },
      adjuntosCount: 0,
    })

    return siniestro
  }

  // ─── Helpers ───────────────────────────────────────────

  private async findConversation(conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { id: true, producerId: true, clientId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return conversation
  }

  private async requireIdentifiedClient(conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        producerId: true,
        client: { select: { ...CLIENT_SUMMARY_SELECT, deletedAt: true } },
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)

    const { client } = conversation
    if (!client || client.deletedAt) {
      throw new ForbiddenException('Conversation has no identified client — call identify first')
    }

    return { clientId: client.id, producerId: conversation.producerId, client }
  }
}
