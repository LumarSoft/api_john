import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { Prisma, Role } from 'generated/prisma/client'
import { parseStaffNames, serializeStaffNames } from '../common/staff-names'
import { type BotProfile, mergeBotProfile, parseBotProfile } from '../common/bot-profile'
import { PrismaService } from '../prisma/prisma.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { CreateProducerCodeDto } from './dto/create-producer-code.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  producerId: true,
  createdAt: true,
  updatedAt: true,
  // Codes this admin can access (empty for SUPERADMIN = all).
  producerCodes: {
    select: { producerCode: { select: { id: true, code: true, holderName: true } } },
  },
} as const

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bot/producer configuration shown in the admin "Configuración" screen. The
   * bot is switched on and off per number (Números → Asistente), not here.
   */
  async getProducerConfig(producerId: number) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { botName: true, staffNames: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    return { botName: producer.botName, staffNames: parseStaffNames(producer.staffNames) }
  }

  /**
   * Updates the producer config; only the fields sent change. An empty botName
   * clears it (bot uses fallback) and an empty staffNames list clears the names.
   */
  async updateProducerConfig(producerId: number, dto: { botName?: string; staffNames?: string[] }) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { id: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    const data: Prisma.ProducerUpdateInput = {}
    if (dto.botName !== undefined) data.botName = dto.botName.trim() || null
    if (dto.staffNames !== undefined) data.staffNames = serializeStaffNames(dto.staffNames)
    const updated = await this.prisma.producer.update({
      where: { id: producerId },
      data,
      select: { botName: true, staffNames: true },
    })
    return { botName: updated.botName, staffNames: parseStaffNames(updated.staffNames) }
  }

  /** The organization's bot profile, as stored (null fields = not configured). */
  async getBotProfile(producerId: number): Promise<BotProfile> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { botProfile: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    return parseBotProfile(producer.botProfile)
  }

  /** Changes the fields sent (an empty string clears one) and returns the whole profile. */
  async updateBotProfile(producerId: number, changes: Partial<Record<keyof BotProfile, string>>): Promise<BotProfile> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { botProfile: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    const profile = mergeBotProfile(producer.botProfile, changes)
    await this.prisma.producer.update({
      where: { id: producerId },
      data: { botProfile: profile as unknown as Prisma.InputJsonObject },
    })
    return profile
  }

  findAll(producerId: number) {
    return this.prisma.user.findMany({
      // The platform OWNER (Lumar) is not a tenant-managed account: hide it from
      // the org's user list so a SuperAdmin can't see/edit/delete it.
      where: { producerId, deletedAt: null, role: { not: Role.OWNER } },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(dto: CreateUserDto, producerId: number) {
    await this.ensureEmailIsFree(dto.email)

    const role = dto.role ?? Role.ADMIN
    if (role === Role.ADMIN) await this.assertCodesBelongToProducer(dto.producerCodeIds ?? [], producerId)

    const password = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name?.trim() || null, password, role, producerId },
      select: { id: true },
    })

    // Grant codes only to ADMIN users (SUPERADMIN sees all codes implicitly).
    if (role === Role.ADMIN && dto.producerCodeIds?.length) {
      await this.prisma.userProducerCode.createMany({
        data: dto.producerCodeIds.map(producerCodeId => ({ userId: user.id, producerCodeId })),
        skipDuplicates: true,
      })
    }

    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SAFE_SELECT })
  }

  async update(id: number, producerId: number, dto: UpdateUserDto) {
    await this.findOneOrThrow(id, producerId)

    if (dto.email) await this.ensureEmailIsFree(dto.email, id)
    if (dto.producerCodeIds) await this.assertCodesBelongToProducer(dto.producerCodeIds, producerId)

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
        ...(dto.role ? { role: dto.role } : {}),
      },
    })

    // If a code set was provided, replace the user's grants wholesale. A user
    // promoted to SUPERADMIN has its explicit grants cleared (it sees all codes).
    const effectiveRole =
      dto.role ?? (await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true } })).role
    if (effectiveRole === Role.SUPERADMIN) {
      await this.prisma.userProducerCode.deleteMany({ where: { userId: id } })
    } else if (dto.producerCodeIds) {
      await this.replaceGrants(id, dto.producerCodeIds)
    }

    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_SELECT })
  }

  async remove(id: number, producerId: number, currentUserId: number) {
    if (id === currentUserId) throw new ForbiddenException('You cannot delete your own account')

    await this.findOneOrThrow(id, producerId)

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return { id }
  }

  /** The logged-in user, with the organization the panel shows its name for. */
  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...SAFE_SELECT, producer: { select: { name: true, slug: true, botProfile: true, logoUrl: true } } },
    })
    if (!user) return null
    const { producer, ...profile } = user
    const brand = parseBotProfile(producer.botProfile)
    // The office line: the active number billed to the master code. The panel
    // opens the SuperAdmin's sections filtered by it.
    const defaultPhoneNumber = await this.prisma.phoneNumber.findFirst({
      where: {
        producerId: user.producerId,
        deletedAt: null,
        isActive: true,
        responsibleProducerCode: { isMaster: true },
      },
      orderBy: { id: 'asc' },
      select: { id: true, number: true },
    })
    return {
      ...profile,
      organization: {
        slug: producer.slug,
        name: producer.name,
        displayName: brand.orgName ?? producer.name,
        shortName: brand.orgShortName,
        // The organization's logo (API-relative URL), or null for its initials.
        logoUrl: producer.logoUrl,
        defaultPhoneNumber,
      },
    }
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.email) await this.ensureEmailIsFree(dto.email, userId)

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: SAFE_SELECT,
    })
  }

  /**
   * A branch's code, created by the SuperAdmin from the branch onboarding. A
   * code that was retired comes back instead of clashing with the
   * (producerId, code) unique; the master code stays the owner's to set.
   */
  async createProducerCode(producerId: number, dto: CreateProducerCodeDto) {
    const code = dto.code.trim()
    const holderName = dto.holderName?.trim() || null
    const select = { id: true, code: true, holderName: true, isMaster: true, isActive: true }
    const existing = await this.prisma.producerCode.findFirst({
      where: { producerId, code },
      select: { id: true, deletedAt: true },
    })
    if (existing && !existing.deletedAt) throw new ConflictException(`El código ${code} ya existe en la organización`)
    if (existing) {
      return this.prisma.producerCode.update({
        where: { id: existing.id },
        data: { deletedAt: null, holderName, isActive: true },
        select,
      })
    }
    return this.prisma.producerCode.create({ data: { code, holderName, producerId }, select })
  }

  /** All producer codes of the organization — for the user-management UI. */
  listProducerCodes(producerId: number) {
    return this.prisma.producerCode.findMany({
      where: { producerId, deletedAt: null },
      select: { id: true, code: true, holderName: true, isMaster: true, isActive: true },
      orderBy: [{ isMaster: 'desc' }, { code: 'asc' }],
    })
  }

  private async findOneOrThrow(id: number, producerId: number) {
    const user = await this.prisma.user.findFirst({
      // Never let org user-management endpoints target the platform OWNER.
      where: { id, producerId, deletedAt: null, role: { not: Role.OWNER } },
      select: SAFE_SELECT,
    })
    if (!user) throw new NotFoundException(`User with id ${id} not found`)
    return user
  }

  private async ensureEmailIsFree(email: string, exceptId?: number) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing && existing.id !== exceptId) throw new ConflictException('Email already in use')
  }

  /** Guards that every code id belongs to the SuperAdmin's own organization. */
  private async assertCodesBelongToProducer(codeIds: number[], producerId: number) {
    if (!codeIds.length) return
    const count = await this.prisma.producerCode.count({
      where: { id: { in: codeIds }, producerId, deletedAt: null },
    })
    if (count !== codeIds.length) {
      throw new BadRequestException('One or more producer codes do not belong to this organization')
    }
  }

  /** Replaces a user's full set of code grants in one transaction. */
  private async replaceGrants(userId: number, codeIds: number[]) {
    await this.prisma.$transaction([
      this.prisma.userProducerCode.deleteMany({ where: { userId } }),
      this.prisma.userProducerCode.createMany({
        data: codeIds.map(producerCodeId => ({ userId, producerCodeId })),
        skipDuplicates: true,
      }),
    ])
  }
}
