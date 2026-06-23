import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { ListSolicitudesDto } from './dto/list-solicitudes.dto'
import { UpdateSolicitudDto } from './dto/update-solicitud.dto'
import type { LeadKind, SolicitudListItem } from './solicitudes.types'

const DEFAULT_PAGE_SIZE = 20

interface CreateLeadContext {
  channel: 'WEB' | 'WHATSAPP'
  producerId: number
  conversationId?: number
}

@Injectable()
export class SolicitudesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Lead creation (web + bot) ─────────────────────────────

  /** Creates a lead from the public web form (anonymous → default producer). */
  async createWebLead(dto: CreateLeadDto): Promise<{ id: number }> {
    return this.createLead(dto, { channel: 'WEB', producerId: await this.resolveDefaultProducerId() })
  }

  /** Creates a lead from the WhatsApp bot, scoped to the conversation's producer. */
  async createBotLead(conversationId: number, dto: CreateLeadDto): Promise<{ id: number }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { producerId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return this.createLead(dto, { channel: 'WHATSAPP', producerId: conversation.producerId, conversationId })
  }

  private async createLead(dto: CreateLeadDto, ctx: CreateLeadContext): Promise<{ id: number }> {
    // A chosen plan must belong to this producer and match the lead's product.
    if (dto.selectedPlanId !== undefined) {
      const plan = await this.prisma.productPlan.findFirst({
        where: { id: dto.selectedPlanId, producerId: ctx.producerId, deletedAt: null },
        select: { productType: true },
      })
      if (!plan) throw new BadRequestException(`Plan ${dto.selectedPlanId} not found`)
      if (plan.productType !== dto.productType) {
        throw new BadRequestException('selectedPlanId does not match productType')
      }
    }

    const lead = await this.prisma.contactLead.create({
      data: {
        producerId: ctx.producerId,
        productType: dto.productType,
        channel: ctx.channel,
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email ?? null,
        payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
        selectedPlanId: dto.selectedPlanId ?? null,
        conversationId: ctx.conversationId ?? null,
      },
      select: { id: true },
    })
    return lead
  }

  // ─── Unified admin panel ───────────────────────────────────

  /**
   * Lists every quote request for the producer: the advisor-contact leads
   * (ContactLead) and the instant auto/moto coverage requests (Solicitud),
   * normalized into one stream. Both sources are small for a broker, so they're
   * fetched, merged and paginated in memory rather than with a SQL UNION.
   */
  async listForAdmin(producerId: number, dto: ListSolicitudesDto) {
    const page = dto.page && dto.page > 0 ? dto.page : 1
    const pageSize = dto.pageSize && dto.pageSize > 0 ? dto.pageSize : DEFAULT_PAGE_SIZE
    const search = dto.search?.trim().toLowerCase()

    const items: SolicitudListItem[] = []

    if (dto.kind !== 'cotizacion') {
      items.push(...(await this.loadLeads(producerId, dto)))
    }
    if (dto.kind !== 'lead') {
      items.push(...(await this.loadCotizaciones(producerId, dto)))
    }

    const filtered = search
      ? items.filter(i => [i.contactName, i.phone, i.email ?? ''].some(field => field.toLowerCase().includes(search)))
      : items

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = filtered.length
    const data = filtered.slice((page - 1) * pageSize, page * pageSize)

    return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  private async loadLeads(producerId: number, dto: ListSolicitudesDto): Promise<SolicitudListItem[]> {
    const leads = await this.prisma.contactLead.findMany({
      where: {
        producerId,
        deletedAt: null,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.productType ? { productType: dto.productType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        productType: true,
        channel: true,
        status: true,
        contactName: true,
        phone: true,
        email: true,
        createdAt: true,
        selectedPlan: { select: { name: true } },
      },
    })

    return leads.map(l => ({
      id: l.id,
      kind: 'lead' as const,
      productType: l.productType,
      contactName: l.contactName,
      phone: l.phone,
      email: l.email,
      summary: l.selectedPlan ? `Plan ${l.selectedPlan.name}` : null,
      channel: l.channel,
      status: l.status,
      createdAt: l.createdAt,
    }))
  }

  private async loadCotizaciones(producerId: number, dto: ListSolicitudesDto): Promise<SolicitudListItem[]> {
    // The auto/moto Solicitud panel filters by vehicleType ("AUTO"/"MOTO").
    const vehicleType = dto.productType === 'auto' ? 'AUTO' : dto.productType === 'moto' ? 'MOTO' : undefined
    // A non-vehicle productType filter excludes every cotizacion.
    if (dto.productType && !vehicleType) return []

    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        deletedAt: null,
        ...(dto.status ? { status: dto.status } : {}),
        cotizacion: {
          producerId,
          deletedAt: null,
          ...(vehicleType ? { vehicleType } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        selectedCoverage: true,
        applicantFirstName: true,
        applicantLastName: true,
        applicantEmail: true,
        applicantPhone: true,
        createdAt: true,
        cotizacion: { select: { vehicleType: true, manufactureYear: true } },
      },
    })

    return solicitudes.map(s => ({
      id: s.id,
      kind: 'cotizacion' as const,
      productType: s.cotizacion.vehicleType.toLowerCase(),
      contactName: `${s.applicantFirstName} ${s.applicantLastName ?? ''}`.trim(),
      phone: s.applicantPhone,
      email: s.applicantEmail,
      summary: `Cobertura ${s.selectedCoverage} · ${s.cotizacion.manufactureYear}`,
      channel: 'WEB',
      status: s.status,
      createdAt: s.createdAt,
    }))
  }

  async getDetail(producerId: number, kind: LeadKind, id: number) {
    if (kind === 'lead') {
      const lead = await this.prisma.contactLead.findFirst({
        where: { id, producerId, deletedAt: null },
        select: {
          id: true,
          productType: true,
          channel: true,
          status: true,
          contactName: true,
          phone: true,
          email: true,
          payload: true,
          notes: true,
          createdAt: true,
          selectedPlan: { select: { id: true, name: true, monthlyPrice: true, productType: true } },
        },
      })
      if (!lead) throw new NotFoundException(`Lead ${id} not found`)
      return {
        kind,
        ...lead,
        selectedPlan: lead.selectedPlan
          ? { ...lead.selectedPlan, monthlyPrice: Number(lead.selectedPlan.monthlyPrice) }
          : null,
      }
    }

    // Card data is intentionally excluded from the detail response.
    const solicitud = await this.prisma.solicitud.findFirst({
      where: { id, deletedAt: null, cotizacion: { producerId } },
      select: {
        id: true,
        status: true,
        notes: true,
        selectedCoverage: true,
        coverageStartDate: true,
        applicantType: true,
        applicantFirstName: true,
        applicantLastName: true,
        applicantEmail: true,
        applicantPhone: true,
        applicantDocType: true,
        applicantDocNumber: true,
        applicantAddress: true,
        paymentMethod: true,
        createdAt: true,
        cotizacion: {
          select: { quoteNumber: true, vehicleType: true, manufactureYear: true, postalCode: true },
        },
      },
    })
    if (!solicitud) throw new NotFoundException(`Solicitud ${id} not found`)
    return { kind, ...solicitud }
  }

  async updateStatus(producerId: number, kind: LeadKind, id: number, dto: UpdateSolicitudDto) {
    if (dto.status === undefined && dto.notes === undefined) {
      throw new BadRequestException('Nothing to update')
    }
    const data = {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    }

    if (kind === 'lead') {
      const lead = await this.prisma.contactLead.findFirst({
        where: { id, producerId, deletedAt: null },
        select: { id: true },
      })
      if (!lead) throw new NotFoundException(`Lead ${id} not found`)
      await this.prisma.contactLead.update({ where: { id }, data })
      return { ok: true }
    }

    const solicitud = await this.prisma.solicitud.findFirst({
      where: { id, deletedAt: null, cotizacion: { producerId } },
      select: { id: true },
    })
    if (!solicitud) throw new NotFoundException(`Solicitud ${id} not found`)
    await this.prisma.solicitud.update({ where: { id }, data })
    return { ok: true }
  }

  // Anonymous web leads belong to the default producer (John), mirroring CotizadorService.
  private async resolveDefaultProducerId(): Promise<number> {
    const slug = this.configService.get<string>('DEFAULT_PRODUCER_SLUG', 'john')
    const producer = await this.prisma.producer.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    })
    if (!producer) throw new InternalServerErrorException(`Default producer "${slug}" not found`)
    return producer.id
  }
}
