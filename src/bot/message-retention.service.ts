import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_COEXISTENCE_HISTORY_RETENTION_DAYS = 180

/**
 * Prunes old WhatsApp chat messages so the `Message` table stays bounded.
 *
 * Deliberate exception to the project-wide soft-delete rule: these are
 * ephemeral bot transcripts, not business records, and the goal is to actually
 * shrink the table — a `deletedAt` flag would leave the rows (and the growth)
 * in place. See docs/rules/database.md § "Exceptions".
 *
 * Only the last 10 messages of a conversation are ever read back, so deleting
 * anything older than the retention window has no functional impact.
 */
@Injectable()
export class MessageRetentionService {
  private readonly logger = new Logger(MessageRetentionService.name)
  private readonly retentionDays: number
  private readonly coexistenceHistoryRetentionDays: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('MESSAGE_RETENTION_DAYS'))
    this.retentionDays = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
    const historyConfigured = Number(config.get<string>('COEXISTENCE_HISTORY_RETENTION_DAYS'))
    this.coexistenceHistoryRetentionDays =
      Number.isInteger(historyConfigured) && historyConfigured > 0
        ? historyConfigured
        : DEFAULT_COEXISTENCE_HISTORY_RETENTION_DAYS
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldMessages(): Promise<void> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - this.retentionDays)
    const historyCutoff = new Date()
    historyCutoff.setDate(historyCutoff.getDate() - this.coexistenceHistoryRetentionDays)

    try {
      // Hard delete on purpose — see the class-level note.
      const { count } = await this.prisma.message.deleteMany({
        where: {
          OR: [
            { source: { not: 'history' }, createdAt: { lt: cutoff } },
            { source: 'history', createdAt: { lt: historyCutoff } },
          ],
        },
      })
      this.logger.log(
        `Pruned ${count} messages (live > ${this.retentionDays} days; ` +
          `Coexistence history > ${this.coexistenceHistoryRetentionDays} days)`,
      )
    } catch (error) {
      this.logger.error(`Message retention job failed: ${(error as Error).message}`)
    }
  }
}
