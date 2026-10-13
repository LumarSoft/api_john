import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron, CronExpression } from '@nestjs/schedule'
import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { PrismaService } from '../prisma/prisma.service'
import { AUDIOS_UPLOAD_DIR, INBOX_UPLOAD_DIR } from '../siniestros/siniestro-upload.config'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_COEXISTENCE_HISTORY_RETENTION_DAYS = 180
const DEFAULT_AUDIO_RETENTION_DAYS = 30

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
  private readonly audioRetentionDays: number

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
    const audioConfigured = Number(config.get<string>('AUDIO_RETENTION_DAYS'))
    this.audioRetentionDays =
      Number.isInteger(audioConfigured) && audioConfigured > 0 ? audioConfigured : DEFAULT_AUDIO_RETENTION_DAYS
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

  /**
   * Deletes stored WhatsApp voice notes older than AUDIO_RETENTION_DAYS. The
   * transcription stays in the message; only the playable file goes, so audio
   * recordings never pile up on disk.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  pruneOldAudios(dir: string = AUDIOS_UPLOAD_DIR, now: Date = new Date()): Promise<number> {
    return this.pruneOldFiles(dir, 'audio', now)
  }

  /**
   * Photos and PDFs sent from the panel follow the same window: the messages
   * that point at them are gone by then, so the files would only pile up.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  pruneOldSentMedia(dir: string = INBOX_UPLOAD_DIR, now: Date = new Date()): Promise<number> {
    return this.pruneOldFiles(dir, 'sent media', now)
  }

  private async pruneOldFiles(dir: string, label: string, now: Date): Promise<number> {
    const cutoff = now.getTime() - this.audioRetentionDays * 24 * 60 * 60 * 1000
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0 // nothing stored yet
      this.logger.error(`Retention job for ${label} failed: ${(error as Error).message}`)
      return 0
    }

    let deleted = 0
    for (const name of names) {
      const path = join(dir, name)
      try {
        const info = await stat(path)
        if (!info.isFile() || info.mtimeMs >= cutoff) continue
        await unlink(path)
        deleted += 1
      } catch (error) {
        this.logger.warn(`Could not prune ${label} ${name}: ${(error as Error).message}`)
      }
    }
    this.logger.log(`Pruned ${deleted} ${label} files (> ${this.audioRetentionDays} days)`)
    return deleted
  }
}
