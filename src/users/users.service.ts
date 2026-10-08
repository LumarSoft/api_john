import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { BotStatusAlertService } from './bot-status-alert.service'

/** Admin who flips the organization-wide bot switch. */
export interface BotStatusActor {
  id: number
  email: string
}

const SAFE_SELECT = {
  id: true,
  email: true,
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
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly botStatusAlerts: BotStatusAlertService,
  ) {}

  /** Bot/producer configuration shown in the admin "Configuración" screen. */
  async getProducerConfig(producerId: number) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { botName: true, botEnabled: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    const lastChange = await this.prisma.botStatusChange.findFirst({
      where: { producerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { botEnabled: true, createdAt: true, user: { select: { email: true } } },
    })
    return {
      botName: producer.botName,
      botEnabled: producer.botEnabled,
      // Who last flipped the switch and when, so the screen can show it.
      lastBotStatusChange: lastChange
        ? { botEnabled: lastChange.botEnabled, at: lastChange.createdAt, by: lastChange.user?.email ?? null }
        : null,
    }
  }

  /** Updates the producer config. An empty botName clears it (bot uses fallback). */
  async updateProducerConfig(producerId: number, dto: { botName?: string }) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { id: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    const botName = dto.botName?.trim()
    const updated = await this.prisma.producer.update({
      where: { id: producerId },
      data: { botName: botName ? botName : null },
      select: { botName: true, botEnabled: true },
    })
    return { botName: updated.botName, botEnabled: updated.botEnabled }
  }

  /**
   * Enables/disables every automated bot response for this organization.
   *
   * Every real flip is recorded in BotStatusChange and announced to the owner
   * (BotStatusAlertService): the switch used to leave no trace, and the office
   * turned the bot off for days without anyone knowing. Setting the same state
   * again is a no-op so a double click never produces a second audit row.
   */
  async setBotEnabled(producerId: number, botEnabled: boolean, actor: BotStatusActor | null = null) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { id: true, name: true, botName: true, botEnabled: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    if (producer.botEnabled === botEnabled) {
      return { botName: producer.botName, botEnabled: producer.botEnabled }
    }

    const previous = await this.prisma.botStatusChange.findFirst({
      where: { producerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    const [updated, change] = await this.prisma.$transaction([
      this.prisma.producer.update({
        where: { id: producerId },
        data: { botEnabled },
        select: { botName: true, botEnabled: true },
      }),
      this.prisma.botStatusChange.create({
        data: { producerId, botEnabled, userId: actor?.id ?? null },
        select: { createdAt: true },
      }),
    ])

    // Best-effort announcement; the switch is already persisted.
    void this.botStatusAlerts
      .notify({
        producerId,
        producerName: producer.name,
        botEnabled,
        actorEmail: actor?.email ?? null,
        at: change.createdAt,
        since: previous?.createdAt ?? null,
      })
      .catch(err => this.logger.warn(`Bot status alert failed: ${(err as Error).message}`))

    return updated
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
      data: { email: dto.email, password, role, producerId },
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

  getProfile(userId: number) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: SAFE_SELECT })
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.email) await this.ensureEmailIsFree(dto.email, userId)

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: SAFE_SELECT,
    })
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
