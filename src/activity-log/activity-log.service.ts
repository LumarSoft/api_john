import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import type { Request } from 'express'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { pageWindow, toPage, type Page } from '../common/pagination'
import { fieldNames, isRecordable, LOGIN_PATH, requestPath } from './request-origin'
import { ListActivityLogDto } from './dto/list-activity-log.dto'

const DEFAULT_RETENTION_DAYS = 180
const DEFAULT_PAGE_SIZE = 50

/** `req.user` as the JWT strategy leaves it. */
interface RequestUser {
  id: number
  producerId: number
  type?: string
}

const ACTIVITY_SELECT = {
  id: true,
  createdAt: true,
  method: true,
  path: true,
  statusCode: true,
  ip: true,
  userAgent: true,
  fields: true,
  loginEmail: true,
  user: { select: { id: true, email: true, name: true, role: true } },
  producer: { select: { id: true, name: true } },
} satisfies Prisma.ActivityLogSelect

export type ActivityLogEntry = Prisma.ActivityLogGetPayload<{ select: typeof ACTIVITY_SELECT }>

/**
 * Who changed what in the panel and from which address. A row is written after
 * the response has gone out, so recording never slows a request down nor makes
 * it fail. Rows older than ACTIVITY_LOG_RETENTION_DAYS are deleted every night.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name)
  private readonly retentionDays: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('ACTIVITY_LOG_RETENTION_DAYS'))
    this.retentionDays = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
  }

  /** Called once a write request has been answered; ignores what is not worth keeping. */
  recordRequest(req: Request, statusCode: number, ip: string): void {
    const path = requestPath(req)
    const user = (req as Request & { user?: RequestUser }).user
    if (!isRecordable(path, user?.type)) return

    this.write(req, path, statusCode, ip, user).catch((error: unknown) =>
      this.logger.warn(`Could not record ${req.method} ${path}: ${error instanceof Error ? error.message : error}`),
    )
  }

  private async write(req: Request, path: string, statusCode: number, ip: string, user?: RequestUser): Promise<void> {
    const body = req.body as Record<string, unknown> | undefined
    const isLogin = path === LOGIN_PATH
    const loginEmail = isLogin && typeof body?.email === 'string' ? body.email.trim().slice(0, 191) : null
    // A login names the account it tried, so failed attempts on it show up too.
    const owner =
      user?.type === 'user'
        ? { id: user.id, producerId: user.producerId }
        : loginEmail
          ? await this.prisma.user.findFirst({
              where: { email: loginEmail, deletedAt: null },
              select: { id: true, producerId: true },
            })
          : null
    const userAgent = req.headers['user-agent']

    await this.prisma.activityLog.create({
      data: {
        userId: owner?.id ?? null,
        producerId: owner?.producerId ?? null,
        method: req.method.slice(0, 8),
        path,
        statusCode,
        ip,
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
        fields: fieldNames(body),
        loginEmail,
      },
    })
  }

  /** The owner's view: newest first, filtered by organization, user, address or failures. */
  async list(query: ListActivityLogDto): Promise<Page<ActivityLogEntry>> {
    const { page, pageSize, skip, take } = pageWindow(query, DEFAULT_PAGE_SIZE)
    const where: Prisma.ActivityLogWhereInput = {
      deletedAt: null,
      ...(query.producerId ? { producerId: query.producerId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.ip ? { ip: query.ip } : {}),
      ...(query.failed ? { statusCode: { gte: 400 } } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    }
    const [data, total] = await Promise.all([
      this.prisma.activityLog.findMany({ where, select: ACTIVITY_SELECT, orderBy: { id: 'desc' }, skip, take }),
      this.prisma.activityLog.count({ where }),
    ])
    return toPage(data, total, page, pageSize)
  }

  @Cron('0 30 3 * * *')
  async pruneOldEntries(): Promise<void> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - this.retentionDays)
    try {
      // Hard delete on purpose: an access log, not a business record (docs/rules/database.md).
      const { count } = await this.prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
      if (count > 0) this.logger.log(`Pruned ${count} activity entries older than ${this.retentionDays} days`)
    } catch (error) {
      this.logger.error(`Activity log pruning failed: ${error instanceof Error ? error.message : error}`)
    }
  }
}
