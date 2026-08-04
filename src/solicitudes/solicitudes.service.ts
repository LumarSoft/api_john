import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { ListSolicitudesDto } from './dto/list-solicitudes.dto'
import { UpdateSolicitudDto } from './dto/update-solicitud.dto'
import type { LeadKind, SolicitudListItem } from './solicitudes.types'

const DEFAULT_PAGE_SIZE = 20

// ─── Quote coverage parsing (same shape the web/bot show) ─────────────
interface RawPaymentOption {
  FormaPagoNom?: string
  Premio?: string
  ValorCuota?: string
  Cuotas?: number
}
interface RawCoverage {
  Cobertura?: string
  Cotizaciones?: RawPaymentOption | RawPaymentOption[]
  Resultado?: { Estado?: string }
}
interface RawQuote {
  SDTSrvCotizacionOut?: { Coberturas?: RawCoverage | RawCoverage[] }
}

export interface QuoteCoverageView {
  code: string
  paymentOptions: { name: string; premium: number; installmentValue: number; installments: number }[]
}

const toArr = <T>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v ? [v] : [])

const minPremiumOf = (c: QuoteCoverageView): number => {
  const ps = c.paymentOptions.map(p => p.premium).filter(p => p > 0)
  return ps.length ? Math.min(...ps) : Number.MAX_SAFE_INTEGER
}

/** Normalizes the stored Triunfo quote into the coverages+prices shown to the client. */
function parseQuoteCoverages(result: unknown): QuoteCoverageView[] {
  const out = (result as RawQuote | null)?.SDTSrvCotizacionOut
  return toArr(out?.Coberturas)
    .filter(c => c.Resultado?.Estado === 'S' && toArr(c.Cotizaciones).length > 0)
    .map(c => ({
      code: c.Cobertura ?? '',
      paymentOptions: toArr(c.Cotizaciones).map(q => ({
        name: q.FormaPagoNom ?? '',
        premium: Number.parseFloat(q.Premio ?? '0') || 0,
        installmentValue: Number.parseFloat(q.ValorCuota ?? '0') || 0,
        installments: q.Cuotas ?? 1,
      })),
    }))
    .sort((a, b) => minPremiumOf(a) - minPremiumOf(b))
}

interface CreateLeadContext {
  channel: 'WEB' | 'WHATSAPP'
  producerId: number
  producerCodeId?: number | null
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

  /** Creates a lead from the WhatsApp bot, scoped to the conversation's producer + code. */
  async createBotLead(conversationId: number, dto: CreateLeadDto): Promise<{ id: number }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { producerId: true, producerCodeId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return this.createLead(dto, {
      channel: 'WHATSAPP',
      producerId: conversation.producerId,
      producerCodeId: conversation.producerCodeId,
      conversationId,
    })
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
        producerCodeId: ctx.producerCodeId ?? null,
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
  async listForAdmin(producerId: number, codeIds: number[], dto: ListSolicitudesDto) {
    const page = dto.page && dto.page > 0 ? dto.page : 1
    const pageSize = dto.pageSize && dto.pageSize > 0 ? dto.pageSize : DEFAULT_PAGE_SIZE
    const search = dto.search?.trim().toLowerCase()

    const items: SolicitudListItem[] = []

    if (dto.kind !== 'cotizacion') {
      items.push(...(await this.loadLeads(producerId, codeIds, dto)))
    }
    if (dto.kind !== 'lead') {
      items.push(...(await this.loadCotizaciones(producerId, codeIds, dto)))
    }

    const filtered = search
      ? items.filter(i => [i.contactName, i.phone, i.email ?? ''].some(field => field.toLowerCase().includes(search)))
      : items

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = filtered.length
    const data = filtered.slice((page - 1) * pageSize, page * pageSize)

    return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  private async loadLeads(
    producerId: number,
    codeIds: number[],
    dto: ListSolicitudesDto,
  ): Promise<SolicitudListItem[]> {
    const leads = await this.prisma.contactLead.findMany({
      where: {
        producerId,
        deletedAt: null,
        // Include leads not yet attributed to a code (anonymous web leads) so any
        // admin of the org can pick them up.
        OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }],
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

  private async loadCotizaciones(
    producerId: number,
    codeIds: number[],
    dto: ListSolicitudesDto,
  ): Promise<SolicitudListItem[]> {
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
          OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }],
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

  async getDetail(producerId: number, codeIds: number[], kind: LeadKind, id: number) {
    const codeOr = [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }]
    if (kind === 'lead') {
      const lead = await this.prisma.contactLead.findFirst({
        where: { id, producerId, deletedAt: null, OR: codeOr },
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
      where: { id, deletedAt: null, cotizacion: { producerId, OR: codeOr } },
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
          // `result` is the full raw Triunfo quote — same source the web/bot used,
          // so the panel shows EXACTLY the same coverages and prices (consistency).
          select: { quoteNumber: true, vehicleType: true, manufactureYear: true, postalCode: true, result: true },
        },
      },
    })
    if (!solicitud) throw new NotFoundException(`Solicitud ${id} not found`)

    const { cotizacion, ...rest } = solicitud
    const { result, ...cotizacionMeta } = cotizacion
    return {
      kind,
      ...rest,
      cotizacion: cotizacionMeta,
      // All quoted coverages with their prices (cheapest first), so the admin sees
      // the same figures presented to the client.
      coverages: parseQuoteCoverages(result),
    }
  }

  async updateStatus(producerId: number, codeIds: number[], kind: LeadKind, id: number, dto: UpdateSolicitudDto) {
    if (dto.status === undefined && dto.notes === undefined) {
      throw new BadRequestException('Nothing to update')
    }
    const codeOr = [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }]
    const data = {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    }

    if (kind === 'lead') {
      const lead = await this.prisma.contactLead.findFirst({
        where: { id, producerId, deletedAt: null, OR: codeOr },
        select: { id: true },
      })
      if (!lead) throw new NotFoundException(`Lead ${id} not found`)
      await this.prisma.contactLead.update({ where: { id }, data })
      return { ok: true }
    }

    const solicitud = await this.prisma.solicitud.findFirst({
      where: { id, deletedAt: null, cotizacion: { producerId, OR: codeOr } },
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
