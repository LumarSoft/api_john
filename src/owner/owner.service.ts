import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'
import { CreateProducerCodeDto } from './dto/create-producer-code.dto'
import { UpdateProducerCodeDto } from './dto/update-producer-code.dto'
import { CreateSuperAdminDto } from './dto/create-superadmin.dto'
import { CreateOrgUserDto, UpdateOrgUserDto } from './dto/manage-user.dto'
import { UsageService } from '../usage/usage.service'

/** Current month key, e.g. "2026-08". Mirrors UsageService's period format. */
function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const round2 = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100])) as T

/** Zero metrics for a producer code with no cartera yet. */
const EMPTY_CODE_METRICS = {
  clients: 0,
  polizas: 0,
  siniestros: 0,
  lastCarteraSyncAt: null as Date | null,
}

// Friendly default tone for a freshly provisioned organization's bot. The owner
// (or the org's SuperAdmin) can refine name/tone later from "Configuración".
const DEFAULT_TONE =
  'Atendé con calidez y cercanía, como alguien del equipo de la productora: voseo argentino, respuestas breves y humanas.'

/** Turns a free-text org name into a URL-safe slug base. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip accents/diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  )
}

/**
 * Platform OWNER operations: provisioning and managing organizations (tenants),
 * their Triunfo producer codes, and their SuperAdmins. This is the only place the
 * Owner creates orgs from — selling to a new client never requires a code deploy.
 */
@Injectable()
export class OwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  /** Every organization on the platform, with at-a-glance counts. */
  async listOrganizations() {
    const orgs = await this.prisma.producer.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        masterCode: true,
        botName: true,
        isActive: true,
        createdAt: true,
        _count: { select: { producerCodes: true, users: true, phoneNumbers: true, clients: true } },
      },
    })
    return orgs.map(o => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      masterCode: o.masterCode,
      botName: o.botName,
      isActive: o.isActive,
      createdAt: o.createdAt,
      counts: {
        codes: o._count.producerCodes,
        users: o._count.users,
        phoneNumbers: o._count.phoneNumbers,
        clients: o._count.clients,
      },
    }))
  }

  /** Detail of one organization: its codes and admins (no cartera). */
  async getOrganization(id: number) {
    const org = await this.prisma.producer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, slug: true, masterCode: true, botName: true, isActive: true, createdAt: true },
    })
    if (!org) throw new NotFoundException(`Organization ${id} not found`)

    const [codes, users] = await Promise.all([
      this.prisma.producerCode.findMany({
        where: { producerId: id, deletedAt: null },
        orderBy: [{ isMaster: 'desc' }, { code: 'asc' }],
        select: { id: true, code: true, holderName: true, isMaster: true, isActive: true },
      }),
      this.prisma.user.findMany({
        where: { producerId: id, deletedAt: null, role: { not: Role.OWNER } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, role: true, createdAt: true },
      }),
    ])

    const [numbers, codeMetrics] = await Promise.all([
      this.phoneNumberDetail(id),
      this.producerCodeDetail(
        id,
        codes.map(c => c.id),
      ),
    ])

    // Merge the per-code metrics onto the code rows so the panel has one object.
    const codesWithMetrics = codes.map(c => ({ ...c, ...(codeMetrics.get(c.id) ?? EMPTY_CODE_METRICS) }))

    const billing = numbers.reduce(
      (acc, n) => {
        acc.costUsd += n.usage.totalCostUsd
        acc.billedUsd += n.usage.billedUsd
        acc.accruedUsd += n.usage.accruedUsd
        acc.marginUsd += n.usage.marginUsd
        return acc
      },
      { costUsd: 0, billedUsd: 0, accruedUsd: 0, marginUsd: 0 },
    )

    return {
      ...org,
      codes: codesWithMetrics,
      users,
      numbers,
      billing: {
        period: currentPeriod(),
        elapsedFraction: this.usage.elapsedFractionOf(currentPeriod()),
        activeNumbers: numbers.filter(n => n.isActive).length,
        ...round2(billing),
      },
    }
  }

  /**
   * Per-number breakdown for the running month: what it costs us, what the
   * organization is invoiced, and how much of that has accrued so far.
   */
  private async phoneNumberDetail(producerId: number) {
    const period = currentPeriod()
    const elapsed = this.usage.elapsedFractionOf(period)

    const phones = await this.prisma.phoneNumber.findMany({
      where: { producerId, deletedAt: null },
      orderBy: { id: 'asc' },
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
        servedCodes: { select: { producerCode: { select: { id: true, code: true } } } },
        usageMonthly: {
          where: { period },
          select: {
            openaiInputTokens: true,
            openaiOutputTokens: true,
            openaiCostUsd: true,
            metaConversations: true,
            metaCostUsd: true,
            totalCostUsd: true,
          },
        },
      },
    })

    return phones.map(p => {
      const u = p.usageMonthly[0]
      const cost = Number(u?.totalCostUsd ?? 0)
      const billed = this.usage.priceFor(p, cost)

      return {
        id: p.id,
        phoneNumberId: p.phoneNumberId,
        number: p.number,
        isActive: p.isActive,
        responsibleCode: p.responsibleProducerCode,
        servedCodes: p.servedCodes.map(s => s.producerCode),
        budget: {
          monthlyBudgetUsd: p.monthlyBudgetUsd != null ? Number(p.monthlyBudgetUsd) : null,
          exceededAt: p.budgetExceededAt,
        },
        usage: {
          period,
          openaiInputTokens: u?.openaiInputTokens ?? 0,
          openaiOutputTokens: u?.openaiOutputTokens ?? 0,
          openaiCostUsd: Number(u?.openaiCostUsd ?? 0),
          metaConversations: u?.metaConversations ?? 0,
          metaCostUsd: Number(u?.metaCostUsd ?? 0),
          totalCostUsd: cost,
          billedUsd: billed,
          accruedUsd: Math.round(billed * elapsed * 100) / 100,
          marginUsd: Math.round((billed - cost) * 100) / 100,
        },
      }
    })
  }

  /**
   * Per-producer-code metrics: portfolio size and how fresh its cartera is.
   * Counting in one grouped query per entity keeps this to four round-trips
   * instead of four per code.
   */
  private async producerCodeDetail(producerId: number, codeIds: number[]) {
    if (!codeIds.length) return new Map<number, typeof EMPTY_CODE_METRICS>()

    const scope = { producerId, deletedAt: null, producerCodeId: { in: codeIds } }

    const [clients, polizas, siniestros, syncMarks] = await Promise.all([
      this.prisma.client.groupBy({ by: ['producerCodeId'], where: scope, _count: { _all: true } }),
      this.prisma.poliza.groupBy({ by: ['producerCodeId'], where: scope, _count: { _all: true } }),
      this.prisma.siniestro.groupBy({ by: ['producerCodeId'], where: scope, _count: { _all: true } }),
      this.prisma.producerCode.findMany({
        where: { id: { in: codeIds } },
        select: { id: true, lastCarteraSyncAt: true },
      }),
    ])

    const map = new Map<number, typeof EMPTY_CODE_METRICS>()
    for (const id of codeIds) map.set(id, { ...EMPTY_CODE_METRICS })

    const put = (
      rows: Array<{ producerCodeId: number | null; _count: { _all: number } }>,
      key: 'clients' | 'polizas' | 'siniestros',
    ) => {
      for (const r of rows) {
        if (r.producerCodeId == null) continue
        const entry = map.get(r.producerCodeId)
        if (entry) entry[key] = r._count._all
      }
    }

    put(clients, 'clients')
    put(polizas, 'polizas')
    put(siniestros, 'siniestros')

    for (const s of syncMarks) {
      const entry = map.get(s.id)
      if (entry) entry.lastCarteraSyncAt = s.lastCarteraSyncAt
    }

    return map
  }

  /** Provisions a new organization + its first SuperAdmin (+ optional codes). */
  async createOrganization(dto: CreateOrganizationDto) {
    await this.ensureEmailIsFree(dto.adminEmail)

    const slug = await this.uniqueSlug(slugify(dto.name))

    // Build the codes to create: the master code (if given) + any extras, deduped.
    const master = dto.masterCode?.trim()
    const codeInputs = new Map<string, { code: string; holderName?: string; isMaster: boolean }>()
    if (master) codeInputs.set(master, { code: master, holderName: dto.name, isMaster: true })
    for (const c of dto.codes ?? []) {
      const code = c.code.trim()
      if (!code) continue
      const existing = codeInputs.get(code)
      codeInputs.set(code, {
        code,
        holderName: c.holderName ?? existing?.holderName,
        isMaster: existing?.isMaster ?? false,
      })
    }

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10)

    const org = await this.prisma.$transaction(async tx => {
      const producer = await tx.producer.create({
        data: {
          name: dto.name.trim(),
          slug,
          masterCode: master || null,
          botName: dto.botName?.trim() || null,
          systemPrompt: DEFAULT_TONE,
          isActive: true,
        },
        select: { id: true },
      })

      if (codeInputs.size) {
        await tx.producerCode.createMany({
          data: [...codeInputs.values()].map(c => ({
            code: c.code,
            holderName: c.holderName ?? null,
            isMaster: c.isMaster,
            producerId: producer.id,
          })),
        })
      }

      await tx.user.create({
        data: {
          email: dto.adminEmail,
          password: passwordHash,
          role: Role.SUPERADMIN,
          producerId: producer.id,
        },
      })

      return producer
    })

    return this.getOrganization(org.id)
  }

  /** Activate / deactivate an organization (soft toggle; never hard-deletes). */
  async setOrganizationActive(id: number, isActive: boolean) {
    await this.getOrganization(id)
    await this.prisma.producer.update({ where: { id }, data: { isActive } })
    return { id, isActive }
  }

  // ── Producer codes ──────────────────────────────────────

  async addCode(producerId: number, dto: CreateProducerCodeDto) {
    await this.getOrganization(producerId)
    const code = dto.code.trim()

    const existing = await this.prisma.producerCode.findFirst({
      where: { producerId, code },
      select: { id: true, deletedAt: true },
    })
    if (existing && !existing.deletedAt) throw new ConflictException(`Code ${code} already exists in this organization`)

    // Revive a soft-deleted code instead of violating the (producerId, code) unique.
    if (existing) {
      return this.prisma.producerCode.update({
        where: { id: existing.id },
        data: { deletedAt: null, holderName: dto.holderName ?? null, isMaster: dto.isMaster ?? false, isActive: true },
        select: { id: true, code: true, holderName: true, isMaster: true, isActive: true },
      })
    }

    return this.prisma.producerCode.create({
      data: {
        code,
        holderName: dto.holderName ?? null,
        isMaster: dto.isMaster ?? false,
        producerId,
      },
      select: { id: true, code: true, holderName: true, isMaster: true, isActive: true },
    })
  }

  async updateCode(producerId: number, codeId: number, dto: UpdateProducerCodeDto) {
    await this.assertCodeBelongsToOrg(codeId, producerId)
    return this.prisma.producerCode.update({
      where: { id: codeId },
      data: {
        ...(dto.holderName !== undefined ? { holderName: dto.holderName } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: { id: true, code: true, holderName: true, isMaster: true, isActive: true },
    })
  }

  // ── SuperAdmins ─────────────────────────────────────────

  async addSuperAdmin(producerId: number, dto: CreateSuperAdminDto) {
    await this.getOrganization(producerId)
    await this.ensureEmailIsFree(dto.email)
    const password = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: { email: dto.email, password, role: Role.SUPERADMIN, producerId },
      select: { id: true, email: true, role: true, createdAt: true },
    })
    return user
  }

  // ── user management (any organization) ──────────────────
  // The tenant-facing /users endpoints are scoped to the caller's own producerId,
  // so the OWNER needs these to operate on an arbitrary organization.

  /** Creates a SUPERADMIN or ADMIN inside an organization. */
  async addUser(producerId: number, dto: CreateOrgUserDto) {
    await this.assertOrganizationExists(producerId)
    await this.ensureEmailIsFree(dto.email)

    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: await bcrypt.hash(dto.password, 10),
        role: dto.role,
        producerId,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    })
  }

  /** Changes a user's role and/or password. */
  async updateUser(producerId: number, userId: number, dto: UpdateOrgUserDto) {
    await this.assertUserBelongsToOrg(producerId, userId)

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: { id: true, email: true, role: true, createdAt: true },
    })
  }

  /** Soft-deletes a user (the codebase never hard-deletes). */
  async removeUser(producerId: number, userId: number) {
    await this.assertUserBelongsToOrg(producerId, userId)
    await this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
    return { id: userId, deleted: true }
  }

  /**
   * Guards every user mutation: the target must live in the given organization
   * and must not be the platform OWNER, which is not tenant-managed.
   */
  private async assertUserBelongsToOrg(producerId: number, userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, producerId, deletedAt: null },
      select: { id: true, role: true },
    })
    if (!user) throw new NotFoundException(`User ${userId} not found in organization ${producerId}`)
    if (user.role === Role.OWNER) throw new BadRequestException('The platform owner account cannot be modified here')
    return user
  }

  // ── helpers ─────────────────────────────────────────────

  private async assertOrganizationExists(id: number) {
    const org = await this.prisma.producer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
    if (!org) throw new NotFoundException(`Organization ${id} not found`)
  }

  private async ensureEmailIsFree(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) throw new ConflictException('Email already in use')
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base
    let n = 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await this.prisma.producer.findUnique({ where: { slug: candidate }, select: { id: true } })
      if (!taken) return candidate
      n += 1
      candidate = `${base}-${n}`.slice(0, 50)
    }
  }

  private async assertCodeBelongsToOrg(codeId: number, producerId: number) {
    const code = await this.prisma.producerCode.findFirst({
      where: { id: codeId, producerId, deletedAt: null },
      select: { id: true },
    })
    if (!code) throw new BadRequestException('Code does not belong to this organization')
  }
}
