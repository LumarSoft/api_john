import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UsageService, currentPeriod } from '../usage/usage.service'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'
import { describeDisconnectReason } from '../whatsapp-onboarding/whatsapp-connection-monitor.service'

/**
 * SuperAdmin management of the organization's WhatsApp numbers. Billing is per
 * active number, on token plans; each carries a responsible code + the codes it
 * serves + a monthly OpenAI budget. The list embeds the month's tokens and plan
 * so the admin sees the charge at a glance.
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
  async list(producerId: number, role?: Role, period = currentPeriod()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
    const isOwner = role === Role.OWNER
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null },
      select: {
        id: true,
        phoneNumberId: true,
        number: true,
        isActive: true,
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
        wabaAccount: { select: { disconnectedAt: true, disconnectReason: true } },
        responsibleProducerCode: { select: { id: true, code: true, holderName: true } },
        servedCodes: { select: { producerCode: { select: { id: true, code: true, holderName: true } } } },
        usageMonthly: {
          where: { period },
          select: {
            openaiCalls: true,
            metaMessages: true,
            metaBillableMessages: true,
            openaiCachedInputTokens: true,
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

    const starts = await this.usage.serviceStarts(numbers.map(n => n.id))
    return numbers.map(n => {
      const usage = n.usageMonthly[0]
      const cost = Number(usage?.totalCostUsd ?? 0)
      const bill = this.usage.billFor(
        { isActive: n.isActive, serviceStartedAt: starts.get(n.id) ?? null },
        usage,
        period,
      )

      return {
        id: n.id,
        phoneNumberId: n.phoneNumberId,
        number: n.number,
        isActive: n.isActive,
        monthlyBudgetUsd: n.monthlyBudgetUsd != null ? Number(n.monthlyBudgetUsd) : null,
        budgetExceededAt: n.budgetExceededAt,
        // Set when Meta dropped the number off Cloud API; cleared by reconnecting.
        disconnectedAt: n.wabaAccount?.disconnectedAt ?? null,
        disconnectReason: n.wabaAccount?.disconnectReason ?? null,
        disconnectReasonLabel: n.wabaAccount?.disconnectedAt
          ? describeDisconnectReason(n.wabaAccount.disconnectReason)
          : null,
        responsibleCode: n.responsibleProducerCode,
        servedCodes: n.servedCodes.map(s => s.producerCode),
        usage: {
          period,
          pricing: this.usage.commercialPricing,
          // Activity is not sensitive: the client may see its own volume.
          openaiCalls: usage?.openaiCalls ?? 0,
          metaMessages: usage?.metaMessages ?? 0,
          inputTokens: usage?.openaiInputTokens ?? 0,
          outputTokens: usage?.openaiOutputTokens ?? 0,
          metaConversations: usage?.metaConversations ?? 0,
          // What the client is being charged: one token per message sent.
          tokens: bill.tokens,
          plan: bill.plan,
          prorated: bill.prorated,
          billedUsd: bill.billedUsd,
          // Our cost and margin: owner only.
          ...(isOwner
            ? {
                metaBillableMessages: usage?.metaBillableMessages ?? 0,
                openaiCostUsd: Number(usage?.openaiCostUsd ?? 0),
                metaCostUsd: Number(usage?.metaCostUsd ?? 0),
                totalCostUsd: cost,
                marginUsd: Math.round((bill.billedUsd - cost) * 100) / 100,
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
