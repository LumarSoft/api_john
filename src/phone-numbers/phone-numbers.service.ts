import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UsageService } from '../usage/usage.service'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'

/** Current month key, e.g. "2026-06". */
function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * SuperAdmin management of the organization's WhatsApp numbers. Billing is per
 * active number; each carries a responsible code + the codes it serves + a
 * monthly budget. The list embeds the current month's usage so the admin sees
 * cost at a glance.
 */
@Injectable()
export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Numbers of an organization with the running month's figures.
   *
   * What the caller sees depends on the role:
   *   - SUPERADMIN/ADMIN (the client) get what they are being charged
   *   - OWNER (Lumar) additionally gets the provider cost and the margin
   *
   * The provider cost is deliberately withheld from tenants: it is our cost
   * structure, not part of their invoice.
   */
  async list(producerId: number, role?: Role) {
    const period = currentPeriod()
    const isOwner = role === Role.OWNER
    const elapsed = this.usage.elapsedFractionOf(period)
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null },
      select: {
        id: true,
        phoneNumberId: true,
        number: true,
        isActive: true,
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
        monthlyBasePriceUsd: true,
        monthlyMaxPriceUsd: true,
        responsibleProducerCode: { select: { id: true, code: true, holderName: true } },
        servedCodes: { select: { producerCode: { select: { id: true, code: true, holderName: true } } } },
        usageMonthly: {
          where: { period },
          select: {
            openaiCostUsd: true,
            metaCostUsd: true,
            totalCostUsd: true,
            openaiInputTokens: true,
            openaiOutputTokens: true,
            metaConversations: true,
          },
        },
      },
      orderBy: { id: 'desc' },
    })

    return numbers.map(n => {
      const usage = n.usageMonthly[0]
      const cost = Number(usage?.totalCostUsd ?? 0)
      const billed = this.usage.priceFor(n, cost)

      return {
        id: n.id,
        phoneNumberId: n.phoneNumberId,
        number: n.number,
        isActive: n.isActive,
        monthlyBudgetUsd: n.monthlyBudgetUsd != null ? Number(n.monthlyBudgetUsd) : null,
        budgetExceededAt: n.budgetExceededAt,
        responsibleCode: n.responsibleProducerCode,
        servedCodes: n.servedCodes.map(s => s.producerCode),
        usage: {
          period,
          // Activity is not sensitive: the client may see its own volume.
          inputTokens: usage?.openaiInputTokens ?? 0,
          outputTokens: usage?.openaiOutputTokens ?? 0,
          metaConversations: usage?.metaConversations ?? 0,
          // Money the client is being charged.
          billedUsd: billed,
          accruedUsd: Math.round(billed * elapsed * 100) / 100,
          // Our cost and margin: owner only.
          ...(isOwner
            ? {
                openaiCostUsd: Number(usage?.openaiCostUsd ?? 0),
                metaCostUsd: Number(usage?.metaCostUsd ?? 0),
                totalCostUsd: cost,
                marginUsd: Math.round((billed - cost) * 100) / 100,
              }
            : {}),
        },
      }
    })
  }

  async create(producerId: number, dto: CreatePhoneNumberDto) {
    const existing = await this.prisma.phoneNumber.findUnique({
      where: { phoneNumberId: dto.phoneNumberId },
      select: { id: true },
    })
    if (existing) throw new ConflictException('That Meta phone number id is already registered')

    await this.assertCodesBelongToProducer(
      [dto.responsibleProducerCodeId, ...(dto.servedCodeIds ?? [])].filter((x): x is number => x != null),
      producerId,
    )

    const phone = await this.prisma.phoneNumber.create({
      data: {
        phoneNumberId: dto.phoneNumberId,
        number: dto.number,
        producerId,
        responsibleProducerCodeId: dto.responsibleProducerCodeId ?? null,
        monthlyBudgetUsd: dto.monthlyBudgetUsd ?? null,
      },
      select: { id: true },
    })

    await this.replaceServedCodes(phone.id, dto.servedCodeIds ?? [])
    return { id: phone.id }
  }

  async update(id: number, producerId: number, dto: UpdatePhoneNumberDto) {
    await this.findOneOrThrow(id, producerId)

    const codesToCheck = [dto.responsibleProducerCodeId, ...(dto.servedCodeIds ?? [])].filter(
      (x): x is number => x != null,
    )
    await this.assertCodesBelongToProducer(codesToCheck, producerId)

    await this.prisma.phoneNumber.update({
      where: { id },
      data: {
        ...(dto.number !== undefined ? { number: dto.number } : {}),
        ...(dto.responsibleProducerCodeId !== undefined
          ? { responsibleProducerCodeId: dto.responsibleProducerCodeId }
          : {}),
        ...(dto.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: dto.monthlyBudgetUsd } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    })

    if (dto.servedCodeIds) await this.replaceServedCodes(id, dto.servedCodeIds)
    return { id }
  }

  async remove(id: number, producerId: number) {
    await this.findOneOrThrow(id, producerId)
    // Soft delete + deactivate so the bot stops resolving it.
    await this.prisma.phoneNumber.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    })
    return { id }
  }

  private async findOneOrThrow(id: number, producerId: number) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true },
    })
    if (!phone) throw new NotFoundException(`Phone number ${id} not found`)
    return phone
  }

  private async assertCodesBelongToProducer(codeIds: number[], producerId: number) {
    const unique = [...new Set(codeIds)]
    if (!unique.length) return
    const count = await this.prisma.producerCode.count({
      where: { id: { in: unique }, producerId, deletedAt: null },
    })
    if (count !== unique.length) {
      throw new BadRequestException('One or more producer codes do not belong to this organization')
    }
  }

  private async replaceServedCodes(phoneNumberId: number, codeIds: number[]) {
    await this.prisma.$transaction([
      this.prisma.phoneNumberProducerCode.deleteMany({ where: { phoneNumberId } }),
      this.prisma.phoneNumberProducerCode.createMany({
        data: codeIds.map(producerCodeId => ({ phoneNumberId, producerCodeId })),
        skipDuplicates: true,
      }),
    ])
  }
}
