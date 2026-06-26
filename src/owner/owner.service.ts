import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'
import { CreateProducerCodeDto } from './dto/create-producer-code.dto'
import { UpdateProducerCodeDto } from './dto/update-producer-code.dto'
import { CreateSuperAdminDto } from './dto/create-superadmin.dto'

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
  constructor(private readonly prisma: PrismaService) {}

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

    return { ...org, codes, users }
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

  // ── helpers ─────────────────────────────────────────────

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
