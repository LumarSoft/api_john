import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UsageService, currentPeriod } from '../usage/usage.service'
import { parseSchedule, validateSchedule } from '../business-hours/schedule'
import { mergeBotProfile, parseBotProfile } from '../common/bot-profile'
import { parseStaffNames, serializeStaffNames } from '../common/staff-names'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'
import { UpdateNumberAssistantDto } from './dto/update-number-assistant.dto'
import { describeDisconnectReason } from '../whatsapp-onboarding/whatsapp-connection-monitor.service'

/** Who asks about a number's assistant. */
interface PanelUser {
  id: number
  producerId: number
  role?: Role
}

const ASSISTANT_SELECT = { botName: true, staffNames: true, businessHours: true, botProfile: true } as const

interface StoredAssistant {
  botName: string | null
  staffNames: string | null
  businessHours: unknown
  botProfile: unknown
}

const hasOwnAssistant = (n: StoredAssistant): boolean =>
  n.botName != null || n.staffNames != null || n.businessHours != null || n.botProfile != null

/**
 * SuperAdmin management of the organization's WhatsApp numbers. Billing is per
 * active number, on token plans; each carries a responsible code + the codes it
 * serves + a monthly OpenAI budget. The list embeds the month's tokens so the
 * office sees its consumption at a glance.
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
   *   - ADMIN: the tokens of the month (one per message sent), what the client pays for
   *   - SUPERADMIN: also the messages and the OpenAI calls and tokens
   *   - OWNER (Lumar): also the plan, its price, the provider cost and the margin
   *
   * Amounts in USD are withheld from tenants: the client is billed in tokens.
   */
  async list(producerId: number, role?: Role, period = currentPeriod(), userId?: number) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
    const isOwner = role === Role.OWNER
    const seesActivity = isOwner || role === Role.SUPERADMIN
    const assistantScope = await this.assistantScope({ id: userId ?? 0, producerId, role })
    const numbers = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null },
      select: {
        id: true,
        phoneNumberId: true,
        number: true,
        isActive: true,
        ...ASSISTANT_SELECT,
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
        // The AI budget guards our OpenAI cost: the SuperAdmin only learns that the AI paused.
        ...(isOwner ? { monthlyBudgetUsd: n.monthlyBudgetUsd != null ? Number(n.monthlyBudgetUsd) : null } : {}),
        ...(seesActivity ? { budgetExceededAt: n.budgetExceededAt } : {}),
        // Set when Meta dropped the number off Cloud API; cleared by reconnecting.
        disconnectedAt: n.wabaAccount?.disconnectedAt ?? null,
        disconnectReason: n.wabaAccount?.disconnectReason ?? null,
        disconnectReasonLabel: n.wabaAccount?.disconnectedAt
          ? describeDisconnectReason(n.wabaAccount.disconnectReason)
          : null,
        responsibleCode: n.responsibleProducerCode,
        servedCodes: n.servedCodes.map(s => s.producerCode),
        // Its own assistant name (null = the organization's) and whether it changes anything.
        assistant: { botName: n.botName, customized: hasOwnAssistant(n) },
        canConfigureAssistant: this.mayConfigure(assistantScope, n.responsibleProducerCode?.id ?? null),
        usage: {
          period,
          // What the client pays for: one token per message sent.
          tokens: bill.tokens,
          ...(seesActivity
            ? {
                metaMessages: usage?.metaMessages ?? 0,
                metaConversations: usage?.metaConversations ?? 0,
                openaiCalls: usage?.openaiCalls ?? 0,
                inputTokens: usage?.openaiInputTokens ?? 0,
                outputTokens: usage?.openaiOutputTokens ?? 0,
              }
            : {}),
          // The plan it is billed on, our cost and margin: owner only.
          ...(isOwner
            ? {
                pricing: this.usage.commercialPricing,
                plan: bill.plan,
                prorated: bill.prorated,
                billedUsd: bill.billedUsd,
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

  /** The AI budget is our cost guard: only the owner sets it, other roles' value is ignored. */
  private budgetFrom(dto: { monthlyBudgetUsd?: number }, role?: Role) {
    return role === Role.OWNER ? dto.monthlyBudgetUsd : undefined
  }

  async create(producerId: number, dto: CreatePhoneNumberDto, role?: Role) {
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
        monthlyBudgetUsd: this.budgetFrom(dto, role) ?? null,
      },
      select: { id: true },
    })

    await this.replaceServedCodes(phone.id, dto.servedCodeIds ?? [])
    return { id: phone.id }
  }

  async update(id: number, producerId: number, dto: UpdatePhoneNumberDto, role?: Role) {
    await this.findOneOrThrow(id, producerId)
    const budget = this.budgetFrom(dto, role)

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
        ...(budget !== undefined ? { monthlyBudgetUsd: budget } : {}),
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

  /**
   * A number's own assistant next to its organization's, which fills whatever
   * the number leaves empty. Every panel user of the organization may read it.
   */
  async getAssistant(id: number, user: PanelUser) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId: user.producerId, deletedAt: null },
      select: {
        id: true,
        number: true,
        responsibleProducerCodeId: true,
        ...ASSISTANT_SELECT,
        producer: { select: { name: true, ...ASSISTANT_SELECT } },
      },
    })
    if (!phone) throw new NotFoundException(`Phone number ${id} not found`)
    const { producer } = phone

    return {
      id: phone.id,
      number: phone.number,
      canEdit: this.mayConfigure(await this.assistantScope(user), phone.responsibleProducerCodeId),
      own: {
        botName: phone.botName,
        staffNames: parseStaffNames(phone.staffNames),
        businessHours: phone.businessHours == null ? null : parseSchedule(phone.businessHours),
        botProfile: parseBotProfile(phone.botProfile),
      },
      organization: {
        name: producer.name,
        botName: producer.botName,
        staffNames: parseStaffNames(producer.staffNames),
        businessHours: parseSchedule(producer.businessHours),
        botProfile: parseBotProfile(producer.botProfile),
      },
    }
  }

  /**
   * Changes a number's own assistant: the SuperAdmin on any number, an admin
   * only on the numbers billed to one of their codes. Clearing a setting gives
   * the number the organization's value back.
   */
  async updateAssistant(id: number, user: PanelUser, dto: UpdateNumberAssistantDto) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId: user.producerId, deletedAt: null },
      select: { responsibleProducerCodeId: true, botProfile: true },
    })
    if (!phone) throw new NotFoundException(`Phone number ${id} not found`)
    if (!this.mayConfigure(await this.assistantScope(user), phone.responsibleProducerCodeId)) {
      throw new ForbiddenException('Only the SuperAdmin or an admin of its code may change this number')
    }

    const data: Prisma.PhoneNumberUpdateInput = {}
    if (dto.botName !== undefined) data.botName = dto.botName.trim() || null
    if (dto.staffNames !== undefined) data.staffNames = serializeStaffNames(dto.staffNames)
    if (dto.businessHours !== undefined) {
      data.businessHours =
        dto.businessHours === null
          ? Prisma.DbNull
          : (validateSchedule(dto.businessHours) as unknown as Prisma.InputJsonValue)
    }
    if (dto.botProfile !== undefined) {
      const own = Object.entries(mergeBotProfile(phone.botProfile, dto.botProfile)).filter(([, v]) => v != null)
      data.botProfile = own.length ? (Object.fromEntries(own) as Prisma.InputJsonObject) : Prisma.DbNull
    }
    await this.prisma.phoneNumber.update({ where: { id }, data })
    return this.getAssistant(id, user)
  }

  /** The codes whose numbers the user may configure; null = every number of the organization. */
  private async assistantScope(user: PanelUser): Promise<number[] | null> {
    if (user.role === Role.OWNER || user.role === Role.SUPERADMIN) return null
    if (!user.id) return []
    const codes = await this.prisma.userProducerCode.findMany({
      where: { userId: user.id },
      select: { producerCodeId: true },
    })
    return codes.map(c => c.producerCodeId)
  }

  private mayConfigure(scope: number[] | null, responsibleCodeId: number | null): boolean {
    return scope === null || (responsibleCodeId != null && scope.includes(responsibleCodeId))
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
