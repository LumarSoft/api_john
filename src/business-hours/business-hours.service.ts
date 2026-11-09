import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
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

@Injectable()
export class BusinessHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** Admin view: the organization's weekly schedule (closures are each number's). */
  async getConfig(producerId: number): Promise<{ weekly: WeeklySchedule }> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { businessHours: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    return { weekly: parseSchedule(producer.businessHours) }
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

  /**
   * Live status for the default producer — the public endpoint for the web: the
   * office line's (the active number billed to the master code) hours and
   * closures, or the organization's hours when it has no such number.
   */
  async getStatusForDefault(): Promise<HoursStatus> {
    const producerId = await this.resolveDefaultProducerId()
    const office = await this.prisma.phoneNumber.findFirst({
      where: { producerId, deletedAt: null, isActive: true, responsibleProducerCode: { isMaster: true } },
      orderBy: { id: 'asc' },
      select: { id: true, businessHours: true, producer: { select: { businessHours: true } } },
    })
    if (office) {
      return computeStatus(
        parseSchedule(office.businessHours ?? office.producer.businessHours),
        await this.activeClosures(office.id),
      )
    }
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { businessHours: true },
    })
    if (!producer) throw new NotFoundException('Producer not found')
    return computeStatus(parseSchedule(producer.businessHours), [])
  }

  /**
   * Live status for a WhatsApp number — what the bot tells its customers: the
   * number's own weekly hours if it has them, its organization's otherwise, and
   * the number's own holidays and closures.
   */
  async getStatusForNumber(phoneNumberId: string): Promise<HoursStatus> {
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId, isActive: true, deletedAt: null },
      select: { id: true, businessHours: true, producer: { select: { businessHours: true } } },
    })
    if (!phone) throw new NotFoundException(`Phone number ${phoneNumberId} is not registered`)
    return computeStatus(
      parseSchedule(phone.businessHours ?? phone.producer.businessHours),
      await this.activeClosures(phone.id),
    )
  }

  // ─── Helpers ───────────────────────────────────────────────

  /** A number's active closures as plain date strings for the open-now computation. */
  private async activeClosures(phoneId: number): Promise<ActiveClosure[]> {
    const today = new Date(`${toDateStr(new Date())}T00:00:00Z`)
    const rows = await this.prisma.businessClosure.findMany({
      where: { phoneNumberId: phoneId, deletedAt: null, endDate: { gte: today } },
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
