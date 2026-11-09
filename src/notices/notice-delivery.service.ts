import { ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeUser } from '../common/scope/scope.service'
import { PlanFeatureKey } from '../plan-features/plan-features'
import { PlanFeaturesService } from '../plan-features/plan-features.service'
import { NoticeKind, Sender } from './notice-delivery'
import { type NoticeTemplate } from './notice-templates'
import { WabaTemplatesService } from './waba-templates.service'

/** The chat a notice lands in, when the client already has one. */
export interface ExistingChat {
  id: number
  clientId: number | null
  phoneNumberId: string | null
}

/**
 * What every notice the platform sends on its own (a rechazo, a póliza
 * vencida) needs from the database: which numbers can send, whether a phone
 * already chats with us, and the notice written into the client's chat as
 * the office's message, so the panel shows it and the bot reads the client's
 * answer as a reply to it.
 */
@Injectable()
export class NoticeDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planFeatures: PlanFeaturesService,
    private readonly templates: WabaTemplatesService,
  ) {}

  /** 403 when the user's role has these notices off (the owner decides it next to the plans). */
  assertRole(user: ScopeUser, feature: PlanFeatureKey): Promise<void> {
    return this.planFeatures.assertRole(user, feature)
  }

  /**
   * Active numbers that can send, the ones on a connected WABA first. With a
   * `feature`, only the numbers whose plan includes it; when there are numbers
   * but none of them has it, it answers 403 with the plan's message. With a
   * `template`, only the numbers whose WhatsApp account has a version of it
   * approved (Meta refuses it from any other), each with the newest one its
   * account has; when none has it, it answers 409.
   */
  async senders(producerId: number, feature?: PlanFeatureKey, template?: NoticeTemplate): Promise<Sender[]> {
    const connected = await this.prisma.phoneNumber.findMany({
      where: {
        producerId,
        isActive: true,
        deletedAt: null,
        OR: [{ wabaAccountId: null }, { wabaAccount: { disconnectedAt: null } }],
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        planId: true,
        phoneNumberId: true,
        wabaAccountId: true,
        responsibleProducerCodeId: true,
        servedCodes: { select: { producerCodeId: true } },
      },
    })
    const phones = feature ? await this.planFeatures.keepWith(connected, feature) : connected
    const senders = phones
      .sort((a, b) => Number(b.wabaAccountId != null) - Number(a.wabaAccountId != null))
      .map(p => ({
        phoneNumberId: p.phoneNumberId,
        wabaAccountId: p.wabaAccountId,
        codeIds: [
          ...(p.responsibleProducerCodeId != null ? [p.responsibleProducerCodeId] : []),
          ...p.servedCodes.map(s => s.producerCodeId),
        ],
      }))
    return template ? this.keepWithTemplate(senders, template) : senders
  }

  /**
   * The senders whose account has a version of the template approved, each
   * with the newest one there. A number without an account of its own (the
   * first one, registered by hand) sends the first version, as it always did;
   * one whose account Meta did not answer for sends the newest and the send
   * says what went wrong.
   */
  private async keepWithTemplate(senders: Sender[], template: NoticeTemplate): Promise<Sender[]> {
    const accountIds = [...new Set(senders.flatMap(s => (s.wabaAccountId != null ? [s.wabaAccountId] : [])))]
    const approved = await this.templates.approvedVersionsIn(accountIds, template)
    const newest = template.versions[template.versions.length - 1]
    const kept = senders.flatMap(s => {
      if (s.wabaAccountId == null) return [{ ...s, template: template.versions[0] }]
      if (!approved.has(s.wabaAccountId)) return [{ ...s, template: newest }]
      const version = approved.get(s.wabaAccountId)
      return version ? [{ ...s, template: version }] : []
    })
    if (senders.length && !kept.length) {
      throw new ConflictException(
        `Meta todavía no aprobó la plantilla ${newest.name} en la cuenta de WhatsApp de ninguno de tus números. ` +
          'Se crea sola en cada cuenta y Meta la revisa (de minutos a un día). No se envió ningún aviso.',
      )
    }
    return kept
  }

  /** WhatsApp ids among `candidates` that already have a chat: they surely use WhatsApp. */
  async knownWaIds(producerId: number, candidates: string[]): Promise<Set<string>> {
    if (!candidates.length) return new Set()
    const chats = await this.prisma.conversation.findMany({
      where: { producerId, waId: { in: [...new Set(candidates)] } },
      select: { waId: true },
    })
    return new Set(chats.map(c => c.waId))
  }

  findConversation(waId: string, producerId: number): Promise<ExistingChat | null> {
    return this.prisma.conversation.findUnique({
      where: { waId_producerId: { waId, producerId } },
      select: { id: true, clientId: true, phoneNumberId: true },
    })
  }

  /**
   * The notice as the office's message in the client's chat (created when they
   * never wrote): the inbox shows it, and for the next days the bot reads what
   * the client writes as an answer to it instead of greeting them from scratch.
   * `rawData` names the notice so the bot can tell it from a person's reply.
   */
  recordInChat(
    row: { waId: string; producerId: number; producerCodeId: number | null; clientId: number | null },
    existing: { id: number; clientId: number | null } | null,
    phoneNumberId: string,
    content: string,
    rawData: Prisma.InputJsonObject & { notice: NoticeKind },
  ): Promise<number> {
    return this.prisma.$transaction(async tx => {
      const now = new Date()
      let conversationId: number
      if (existing) {
        conversationId = existing.id
        if (!existing.clientId && row.clientId) {
          await tx.conversation.update({
            where: { id: existing.id },
            data: { clientId: row.clientId, clientLinkedAt: now },
          })
        }
      } else {
        const created = await tx.conversation.create({
          data: {
            waId: row.waId,
            producerId: row.producerId,
            phoneNumberId,
            producerCodeId: row.producerCodeId,
            clientId: row.clientId,
            clientLinkedAt: row.clientId ? now : null,
            sessionStartedAt: now,
          },
          select: { id: true },
        })
        conversationId = created.id
      }
      const message = await tx.message.create({
        data: { conversationId, role: 'agent', content, rawData },
        select: { createdAt: true },
      })
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } })
      return conversationId
    })
  }
}
