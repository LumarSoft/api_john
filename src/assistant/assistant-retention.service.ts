import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'

const DEFAULT_RETENTION_DAYS = 90
const BATCH = 200

/**
 * Conversations with the assistant are a working aid, not a business record:
 * the ones nobody touched in ASSISTANT_RETENTION_DAYS (default 90) are deleted
 * every night with their messages and proposals, so they don't pile up with
 * client data quoted in them. The changes those proposals made stay where
 * they were made (and in the activity log). A sanctioned hard delete: see
 * docs/rules/database.md.
 */
@Injectable()
export class AssistantRetentionService {
  private readonly logger = new Logger(AssistantRetentionService.name)
  private readonly retentionDays: number

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('ASSISTANT_RETENTION_DAYS'))
    this.retentionDays = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS
  }

  @Cron('0 15 3 * * *')
  async pruneOldConversations(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - this.retentionDays * 86_400_000)
    let deleted = 0
    try {
      for (;;) {
        const old = await this.prisma.assistantConversation.findMany({
          where: { updatedAt: { lt: before } },
          select: { id: true },
          take: BATCH,
        })
        if (!old.length) break
        const ids = old.map(c => c.id)
        await this.prisma.$transaction([
          this.prisma.assistantAction.deleteMany({ where: { conversationId: { in: ids } } }),
          this.prisma.assistantMessage.deleteMany({ where: { conversationId: { in: ids } } }),
          this.prisma.assistantConversation.deleteMany({ where: { id: { in: ids } } }),
        ])
        deleted += ids.length
        if (ids.length < BATCH) break
      }
      if (deleted)
        this.logger.log(`Se borraron ${deleted} conversaciones del asistente sin uso hace ${this.retentionDays} días`)
    } catch (error) {
      this.logger.error(`No se pudieron borrar las conversaciones viejas del asistente: ${(error as Error).message}`)
    }
    return deleted
  }
}
