import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UsageService, currentPeriod } from '../usage/usage.service'
import { legacyPricing, withLegacyPlan } from '../usage/legacy-token-fields'
import { parseSchedule, validateSchedule } from '../business-hours/schedule'
import { mergeBotProfile, parseBotProfile } from '../common/bot-profile'
import { normalizeCoverageOverrides, parseCoverageOverrides } from '../common/coverage-overrides'
import { parseStaffNames, serializeStaffNames } from '../common/staff-names'
import { CoverageSettingsService } from '../coverage-settings/coverage-settings.service'
import { BotStatusAlertService } from '../users/bot-status-alert.service'
import { CreatePhoneNumberDto } from './dto/create-phone-number.dto'
import { UpdatePhoneNumberDto } from './dto/update-phone-number.dto'
import { UpdateNumberAssistantDto } from './dto/update-number-assistant.dto'
import { CreateClosureDto } from '../business-hours/dto/create-closure.dto'
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
const CLOSURE_SELECT = { id: true, startDate: true, endDate: true, reason: true, source: true } as const

function toClosureView(c: { id: number; startDate: Date; endDate: Date; reason: string; source: string | null }) {
  return {
    id: c.id,
    startDate: c.startDate.toISOString().slice(0, 10),
    endDate: c.endDate.toISOString().slice(0, 10),
    reason: c.reason,
    // True for a national holiday loaded by the sync; false for one the office added.
    holiday: c.source === 'holiday',
  }
}

@Injectable()
export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly coverages: CoverageSettingsService,
    private readonly botStatusAlerts: BotStatusAlertService,
  ) {}

  /**
   * Numbers of an organization with the running month's figures.
   *
   * What the caller sees depends on the role:
   *   - ADMIN: the messages of the month, the number's plan and what the month
   *     adds up to at the catalog's prices
   *   - SUPERADMIN: also the OpenAI calls and tokens
   *   - OWNER (Lumar): also what Meta and OpenAI cost and the profit (billed − Meta)
   */
  async list(producerId: number, role?: Role, period = currentPeriod(), userId?: number) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > currentPeriod())
      throw new BadRequestException('Mes inválido')
    const isOwner = role === Role.OWNER
    const seesActivity = isOwner || role === Role.SUPERADMIN
    const scope = await this.numberScope({ id: userId ?? 0, producerId, role })
    const numbers = await this.prisma.phoneNumber.findMany({
      // An admin sees only the numbers billed to one of their codes.
      where: { producerId, deletedAt: null, ...(scope ? { responsibleProducerCodeId: { in: scope } } : {}) },
      select: {
        id: true,
        phoneNumberId: true,
        number: true,
        isActive: true,
        botEnabled: true,
        ...ASSISTANT_SELECT,
        monthlyBudgetUsd: true,
        budgetExceededAt: true,
        planId: true,
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

    const [starts, catalog] = await Promise.all([
      this.usage.serviceStarts(numbers.map(n => n.id)),
      this.usage.catalog(),
    ])
    const { blockMessages } = this.usage.commercialPricing
    return numbers.map(n => {
      const usage = n.usageMonthly[0]
      const cost = Number(usage?.totalCostUsd ?? 0)
      const metaCost = Number(usage?.metaCostUsd ?? 0)
      const bill = this.usage.billFor(
        { isActive: n.isActive, serviceStartedAt: starts.get(n.id) ?? null, planId: n.planId },
        usage,
        catalog,
        period,
      )

      return {
        id: n.id,
        phoneNumberId: n.phoneNumberId,
        number: n.number,
        isActive: n.isActive,
        // The number's own bot switch (the organization's is in GET /admin/config).
        botEnabled: n.botEnabled,
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
        canConfigureAssistant: this.inScope(scope, n.responsibleProducerCode?.id ?? null),
        usage: {
          period,
          // What the organization pays for: the messages sent, on the plan that covers the month.
          messages: bill.messages,
          assignedPlan: bill.assignedPlan,
          plan: withLegacyPlan(bill.plan, blockMessages),
          upgraded: bill.upgraded,
          prorated: bill.prorated,
          billedUsd: bill.billedUsd,
          // front_John's panel (legacy-token-fields.ts).
          tokens: bill.messages,
          ...(seesActivity
            ? {
                metaMessages: usage?.metaMessages ?? 0,
                metaConversations: usage?.metaConversations ?? 0,
                openaiCalls: usage?.openaiCalls ?? 0,
                inputTokens: usage?.openaiInputTokens ?? 0,
                outputTokens: usage?.openaiOutputTokens ?? 0,
              }
            : {}),
          // Our cost and profit: owner only. OpenAI is prepaid, so the profit is billed minus Meta.
          ...(isOwner
            ? {
                metaBillableMessages: usage?.metaBillableMessages ?? 0,
                openaiCostUsd: Number(usage?.openaiCostUsd ?? 0),
                metaCostUsd: metaCost,
                totalCostUsd: cost,
                marginUsd: Math.round((bill.billedUsd - metaCost) * 100) / 100,
                pricing: legacyPricing(catalog, blockMessages),
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

    // A new account's number starts on the trial plan.
    const planId = await this.usage.initialPlanIdFor(producerId)
    const phone = await this.prisma.phoneNumber.create({
      data: {
        phoneNumberId: dto.phoneNumberId,
        number: dto.number,
        producerId,
        responsibleProducerCodeId: dto.responsibleProducerCodeId ?? null,
        monthlyBudgetUsd: this.budgetFrom(dto, role) ?? null,
        planId,
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
   * the number leaves empty. Readable by whoever sees the number: the SuperAdmin
   * any of the organization's, an admin those billed to one of their codes.
   */
  async getAssistant(id: number, user: PanelUser) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId: user.producerId, deletedAt: null },
      select: {
        id: true,
        number: true,
        responsibleProducerCodeId: true,
        botEnabled: true,
        coverageSettings: true,
        ...ASSISTANT_SELECT,
        producer: { select: { name: true, ...ASSISTANT_SELECT } },
      },
    })
    if (!phone || !this.inScope(await this.numberScope(user), phone.responsibleProducerCodeId)) {
      throw new NotFoundException(`Phone number ${id} not found`)
    }
    const { producer } = phone
    const [coverages, lastBotStatusChange, closures] = await Promise.all([
      this.coverages.listForAdmin(user.producerId),
      this.lastBotStatusChange(phone.id),
      this.upcomingClosures(phone.id),
    ])

    return {
      id: phone.id,
      number: phone.number,
      // Whoever sees a number may configure it.
      canEdit: true,
      own: {
        botName: phone.botName,
        staffNames: parseStaffNames(phone.staffNames),
        businessHours: phone.businessHours == null ? null : parseSchedule(phone.businessHours),
        botProfile: parseBotProfile(phone.botProfile),
        // The number's own switch; who last flipped it is in lastBotStatusChange.
        botEnabled: phone.botEnabled,
        // Only what the number changes about each coverage, keyed by code.
        coverageSettings: parseCoverageOverrides(phone.coverageSettings),
        // Its holidays and closures, upcoming or under way (national holidays included).
        closures,
      },
      organization: {
        name: producer.name,
        botName: producer.botName,
        staffNames: parseStaffNames(producer.staffNames),
        businessHours: parseSchedule(producer.businessHours),
        botProfile: parseBotProfile(producer.botProfile),
        // The coverages as the organization offers them: what the number's own settings start from.
        coverages: coverages.map(c => ({
          id: c.id,
          code: c.code,
          name: c.name,
          isActive: c.isActive,
          highlighted: c.highlighted,
          sortOrder: c.sortOrder,
          needsReview: c.needsReview,
        })),
      },
      lastBotStatusChange,
    }
  }

  /**
   * The number's own bot switch: off, the bot stops answering on this number
   * while the organization's other numbers go on. Same scope as the assistant
   * (the SuperAdmin any number, an admin those billed to one of their codes).
   * A real flip is audited (BotStatusChange with the number) and announced to
   * the owner; setting the current state again does nothing. There is no
   * organization-wide switch: each number is turned on and off here.
   */
  async setBotEnabled(id: number, user: PanelUser, botEnabled: boolean) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId: user.producerId, deletedAt: null },
      select: {
        id: true,
        number: true,
        botEnabled: true,
        responsibleProducerCodeId: true,
        producer: { select: { name: true } },
      },
    })
    if (!phone || !this.inScope(await this.numberScope(user), phone.responsibleProducerCodeId)) {
      throw new NotFoundException(`Phone number ${id} not found`)
    }
    if (phone.botEnabled === botEnabled) {
      return { id: phone.id, botEnabled, lastBotStatusChange: await this.lastBotStatusChange(phone.id) }
    }

    const previous = await this.prisma.botStatusChange.findFirst({
      where: { phoneNumberId: phone.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const [, change] = await this.prisma.$transaction([
      this.prisma.phoneNumber.update({ where: { id: phone.id }, data: { botEnabled }, select: { id: true } }),
      this.prisma.botStatusChange.create({
        data: { producerId: user.producerId, phoneNumberId: phone.id, botEnabled, userId: user.id || null },
        select: { createdAt: true },
      }),
    ])

    const actor = user.id ? await this.prisma.user.findFirst({ where: { id: user.id }, select: { email: true } }) : null
    // Best-effort announcement; the switch is already persisted.
    void this.botStatusAlerts
      .notify({
        producerId: user.producerId,
        producerName: `${phone.producer.name} · ${phone.number}`,
        botEnabled,
        actorEmail: actor?.email ?? null,
        at: change.createdAt,
        since: previous?.createdAt ?? null,
      })
      .catch(() => undefined)

    return { id: phone.id, botEnabled, lastBotStatusChange: await this.lastBotStatusChange(phone.id) }
  }

  /** Who last flipped the number's own switch and when, for the panel. */
  private async lastBotStatusChange(phoneNumberId: number) {
    const change = await this.prisma.botStatusChange.findFirst({
      where: { phoneNumberId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { botEnabled: true, createdAt: true, user: { select: { email: true } } },
    })
    return change ? { botEnabled: change.botEnabled, at: change.createdAt, by: change.user?.email ?? null } : null
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
    if (!phone || !this.inScope(await this.numberScope(user), phone.responsibleProducerCodeId)) {
      throw new NotFoundException(`Phone number ${id} not found`)
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
    if (dto.coverageSettings !== undefined) {
      // Only codes the organization has a coverage for; what is left unset is the organization's.
      const codes = (await this.coverages.listForAdmin(user.producerId)).map(c => c.code)
      const overrides = normalizeCoverageOverrides(dto.coverageSettings, codes)
      data.coverageSettings = overrides ? (overrides as unknown as Prisma.InputJsonObject) : Prisma.DbNull
    }
    await this.prisma.phoneNumber.update({ where: { id }, data })
    return this.getAssistant(id, user)
  }

  /**
   * The codes whose numbers the user sees and configures: an admin's own codes.
   * Null = every number of the organization (SuperAdmin and OWNER).
   */
  // ─── Holidays and closures ─────────────────────────────

  /**
   * Closes one number for a day or a range (a holiday, vacations): its bot says
   * so and promises the next opening. Only this number: a branch's closure never
   * closes the others. Same scope as the assistant.
   */
  async addClosure(id: number, user: PanelUser, dto: CreateClosureDto) {
    const phone = await this.findConfigurable(id, user)
    if (dto.startDate > dto.endDate) throw new BadRequestException('La fecha de inicio es posterior a la de fin')
    const created = await this.prisma.businessClosure.create({
      data: {
        producerId: user.producerId,
        phoneNumberId: phone.id,
        startDate: new Date(`${dto.startDate}T00:00:00Z`),
        endDate: new Date(`${dto.endDate}T00:00:00Z`),
        reason: dto.reason.trim(),
      },
      select: CLOSURE_SELECT,
    })
    return toClosureView(created)
  }

  /** Reopens a number on a closed day; a national holiday removed here stays removed for this number only. */
  async removeClosure(id: number, closureId: number, user: PanelUser) {
    const phone = await this.findConfigurable(id, user)
    const closure = await this.prisma.businessClosure.findFirst({
      where: { id: closureId, phoneNumberId: phone.id, deletedAt: null },
      select: { id: true },
    })
    if (!closure) throw new NotFoundException(`Closure ${closureId} not found`)
    await this.prisma.businessClosure.update({ where: { id: closureId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  /** The number's closures that end today or later, soonest first. */
  private async upcomingClosures(phoneId: number) {
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
    const rows = await this.prisma.businessClosure.findMany({
      where: { phoneNumberId: phoneId, deletedAt: null, endDate: { gte: today } },
      orderBy: { startDate: 'asc' },
      select: CLOSURE_SELECT,
    })
    return rows.map(toClosureView)
  }

  /** A number the user may configure (the SuperAdmin any, an admin those billed to its codes). */
  private async findConfigurable(id: number, user: PanelUser) {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { id, producerId: user.producerId, deletedAt: null },
      select: { id: true, responsibleProducerCodeId: true },
    })
    if (!phone || !this.inScope(await this.numberScope(user), phone.responsibleProducerCodeId)) {
      throw new NotFoundException(`Phone number ${id} not found`)
    }
    return phone
  }

  private async numberScope(user: PanelUser): Promise<number[] | null> {
    if (user.role === Role.OWNER || user.role === Role.SUPERADMIN) return null
    if (!user.id) return []
    const codes = await this.prisma.userProducerCode.findMany({
      where: { userId: user.id },
      select: { producerCodeId: true },
    })
    return codes.map(c => c.producerCodeId)
  }

  private inScope(scope: number[] | null, responsibleCodeId: number | null): boolean {
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
