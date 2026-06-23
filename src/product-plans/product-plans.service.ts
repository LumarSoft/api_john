import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePlanDto } from './dto/create-plan.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'
import type { FixedProductType } from '../solicitudes/solicitudes.types'

const PLAN_SELECT = {
  id: true,
  productType: true,
  name: true,
  monthlyPrice: true,
  description: true,
  coverageItems: true,
  isActive: true,
  sortOrder: true,
} as const

type PlanRow = Prisma.ProductPlanGetPayload<{ select: typeof PLAN_SELECT }>

@Injectable()
export class ProductPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Public (web) ──────────────────────────────────────────

  /** Active plans of a product for the default producer (anonymous web). */
  async listPublic(productType: FixedProductType) {
    return this.listActive(await this.resolveDefaultProducerId(), productType)
  }

  /** Active plans of a product for the conversation's producer (bot, multi-tenant). */
  async listForConversation(conversationId: number, productType: FixedProductType) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { producerId: true },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return this.listActive(conversation.producerId, productType)
  }

  private async listActive(producerId: number, productType: FixedProductType) {
    const plans = await this.prisma.productPlan.findMany({
      where: { producerId, productType, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: PLAN_SELECT,
    })
    return plans.map(p => this.toResponse(p))
  }

  // ─── Admin CRUD ────────────────────────────────────────────

  async listForAdmin(producerId: number) {
    const plans = await this.prisma.productPlan.findMany({
      where: { producerId, deletedAt: null },
      orderBy: [{ productType: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: PLAN_SELECT,
    })
    return plans.map(p => this.toResponse(p))
  }

  async create(producerId: number, dto: CreatePlanDto) {
    const plan = await this.prisma.productPlan.create({
      data: {
        producerId,
        productType: dto.productType,
        name: dto.name,
        monthlyPrice: dto.monthlyPrice,
        description: dto.description ?? null,
        coverageItems: dto.coverageItems as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
      select: PLAN_SELECT,
    })
    return this.toResponse(plan)
  }

  async update(producerId: number, id: number, dto: UpdatePlanDto) {
    await this.requirePlan(producerId, id)
    const plan = await this.prisma.productPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.coverageItems !== undefined
          ? { coverageItems: dto.coverageItems as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: PLAN_SELECT,
    })
    return this.toResponse(plan)
  }

  async remove(producerId: number, id: number) {
    await this.requirePlan(producerId, id)
    await this.prisma.productPlan.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private async requirePlan(producerId: number, id: number) {
    const plan = await this.prisma.productPlan.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true },
    })
    if (!plan) throw new NotFoundException(`Plan ${id} not found`)
    return plan
  }

  private toResponse(plan: PlanRow) {
    return {
      id: plan.id,
      productType: plan.productType,
      name: plan.name,
      monthlyPrice: Number(plan.monthlyPrice),
      description: plan.description,
      coverageItems: (plan.coverageItems ?? []) as Array<{ label: string; category?: string; amount: number }>,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    }
  }

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
