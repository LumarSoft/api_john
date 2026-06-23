import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateClosureDto } from './dto/create-closure.dto'
import { UpdateScheduleDto } from './dto/update-schedule.dto'
import {
  type ActiveClosure,
  computeStatus,
  DEFAULT_SCHEDULE,
  type HoursStatus,
  parseSchedule,
  validateSchedule,
  type WeeklySchedule,
} from './schedule'

const toDateStr = (d: Date): string => d.toISOString().slice(0, 10)

export interface ClosureView {
  id: number
  startDate: string
  endDate: string
  reason: string
}

@Injectable()
export class BusinessHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** Admin view: the weekly schedule plus the upcoming/active closures. */
  async getConfig(producerId: number): Promise<{ weekly: WeeklySchedule; closures: ClosureView[] }> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { businessHours: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    const closures = await this.listClosures(producerId)
    return { weekly: parseSchedule(producer.businessHours), closures }
  }

  async updateSchedule(producerId: number, dto: UpdateScheduleDto): Promise<{ weekly: WeeklySchedule }> {
    const weekly = validateSchedule(dto.weekly)
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { id: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    await this.prisma.producer.update({
      where: { id: producerId },
      data: { businessHours: weekly as unknown as Prisma.InputJsonValue },
    })
    return { weekly }
  }

  async addClosure(producerId: number, dto: CreateClosureDto): Promise<ClosureView> {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('startDate must be on or before endDate')
    }
    const created = await this.prisma.businessClosure.create({
      data: {
        producerId,
        startDate: new Date(`${dto.startDate}T00:00:00Z`),
        endDate: new Date(`${dto.endDate}T00:00:00Z`),
        reason: dto.reason.trim(),
      },
      select: { id: true, startDate: true, endDate: true, reason: true },
    })
    return {
      id: created.id,
      startDate: toDateStr(created.startDate),
      endDate: toDateStr(created.endDate),
      reason: created.reason,
    }
  }

  async removeClosure(producerId: number, id: number): Promise<{ ok: true }> {
    const closure = await this.prisma.businessClosure.findFirst({
      where: { id, producerId, deletedAt: null },
      select: { id: true },
    })
    if (!closure) throw new NotFoundException('Closure not found')
    await this.prisma.businessClosure.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  /** Live status (formatted hours + open-now + today's closure) for a producer. */
  async getStatus(producerId: number): Promise<HoursStatus> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { businessHours: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')

    const closures = await this.activeClosures(producerId)
    return computeStatus(parseSchedule(producer.businessHours), closures)
  }

  /** Live status for the default producer — the public endpoint for web + bot. */
  async getStatusForDefault(): Promise<HoursStatus> {
    return this.getStatus(await this.resolveDefaultProducerId())
  }

  // ─── Helpers ───────────────────────────────────────────────

  /** Upcoming + active closures (endDate today or later), for the admin list. */
  private async listClosures(producerId: number): Promise<ClosureView[]> {
    const today = new Date(`${toDateStr(new Date())}T00:00:00Z`)
    const rows = await this.prisma.businessClosure.findMany({
      where: { producerId, deletedAt: null, endDate: { gte: today } },
      orderBy: { startDate: 'asc' },
      select: { id: true, startDate: true, endDate: true, reason: true },
    })
    return rows.map(r => ({
      id: r.id,
      startDate: toDateStr(r.startDate),
      endDate: toDateStr(r.endDate),
      reason: r.reason,
    }))
  }

  /** Active closures as plain date strings for the open-now computation. */
  private async activeClosures(producerId: number): Promise<ActiveClosure[]> {
    const today = new Date(`${toDateStr(new Date())}T00:00:00Z`)
    const rows = await this.prisma.businessClosure.findMany({
      where: { producerId, deletedAt: null, endDate: { gte: today } },
      select: { startDate: true, endDate: true, reason: true },
    })
    return rows.map(r => ({ startDate: toDateStr(r.startDate), endDate: toDateStr(r.endDate), reason: r.reason }))
  }

  private async resolveDefaultProducerId(): Promise<number> {
    const slug = this.configService.get<string>('DEFAULT_PRODUCER_SLUG', 'john')
    const producer = await this.prisma.producer.findFirst({ where: { slug, deletedAt: null }, select: { id: true } })
    if (!producer) throw new InternalServerErrorException(`Default producer "${slug}" not found`)
    return producer.id
  }

  /** The default schedule, exposed so callers can show it before any edit. */
  get defaultSchedule(): WeeklySchedule {
    return DEFAULT_SCHEDULE
  }
}
