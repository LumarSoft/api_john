import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

const SAFE_SELECT = {
  id: true,
  email: true,
  role: true,
  producerId: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bot/producer configuration shown in the admin "Configuración" screen. */
  async getProducerConfig(producerId: number) {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { botName: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    return { botName: producer.botName }
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
      select: { botName: true },
    })
    return { botName: updated.botName }
  }

  findAll(producerId: number) {
    return this.prisma.user.findMany({
      where: { producerId, deletedAt: null },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(dto: CreateUserDto, producerId: number) {
    await this.ensureEmailIsFree(dto.email)

    const password = await bcrypt.hash(dto.password, 10)
    return this.prisma.user.create({
      data: { email: dto.email, password, role: 'admin', producerId },
      select: SAFE_SELECT,
    })
  }

  async update(id: number, producerId: number, dto: UpdateUserDto) {
    await this.findOneOrThrow(id, producerId)

    if (dto.email) await this.ensureEmailIsFree(dto.email, id)

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: SAFE_SELECT,
    })
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

  private async findOneOrThrow(id: number, producerId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, producerId, deletedAt: null },
      select: SAFE_SELECT,
    })
    if (!user) throw new NotFoundException(`User with id ${id} not found`)
    return user
  }

  private async ensureEmailIsFree(email: string, exceptId?: number) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing && existing.id !== exceptId) throw new ConflictException('Email already in use')
  }
}
