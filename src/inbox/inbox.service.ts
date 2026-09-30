import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { signAdjuntoUrl } from '../siniestros/adjunto-url'
import { BotNotifierService } from './bot-notifier.service'
import { ListInboxDto } from './dto/list-inbox.dto'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// Conversations not yet attributed to a code (unidentified WhatsApp numbers) stay
// visible to every admin of the org so new handoffs can be picked up.
const codeScopeOr = (codeIds: number[]): Prisma.ConversationWhereInput[] => [
  { OR: [{ producerCodeId: { in: codeIds } }, { producerCodeId: null }] },
]

const CONVERSATION_SUMMARY_SELECT = {
  id: true,
  waId: true,
  status: true,
  botPaused: true,
  assignedToUserId: true,
  assignedTo: { select: { id: true, email: true } },
  handedOverAt: true,
  lastMessageAt: true,
  unreadCount: true,
  lastReadAt: true,
  sessionStartedAt: true,
  phoneNumberId: true,
  client: { select: { id: true, firstName: true, lastName: true, dni: true } },
} as const

const CONVERSATION_LIST_SELECT = {
  ...CONVERSATION_SUMMARY_SELECT,
  producer: { select: { botEnabled: true } },
  messages: {
    where: { role: 'user', deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { createdAt: true },
  },
  _count: {
    select: { messages: { where: { role: 'user', deletedAt: null } } },
  },
} as const

function messageMedia(rawData: Prisma.JsonValue | null) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const media = (rawData as Prisma.JsonObject).media
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null
  const value = media as Prisma.JsonObject
  if (typeof value.url !== 'string' || typeof value.mimeType !== 'string') return null
  return {
    url: signAdjuntoUrl(value.url),
    mimeType: value.mimeType,
    originalName: typeof value.originalName === 'string' ? value.originalName : 'imagen',
    size: typeof value.size === 'number' ? value.size : null,
    tipo: typeof value.tipo === 'string' ? value.tipo : null,
  }
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifier: BotNotifierService,
  ) {}

  async listConversations(producerId: number, codeIds: number[], dto: ListInboxDto, metaPhoneNumberId?: string | null) {
    const statusFilter = dto.status ? [dto.status] : ['open', 'pending']
    const search = dto.search?.trim()

    const conversations = await this.prisma.conversation.findMany({
      where: {
        producerId,
        deletedAt: null,
        status: { in: statusFilter },
        ...(metaPhoneNumberId ? { phoneNumberId: metaPhoneNumberId } : {}),
        AND: [
          ...codeScopeOr(codeIds),
          ...(search
            ? [
                {
                  OR: [
                    { client: { firstName: { contains: search } } },
                    { client: { lastName: { contains: search } } },
                    { client: { dni: { contains: search } } },
                    { waId: { contains: search } },
                  ],
                } as Prisma.ConversationWhereInput,
              ]
            : []),
        ],
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: CONVERSATION_LIST_SELECT,
    })

    return conversations.map(({ messages, producer, _count, ...conversation }) => ({
      ...conversation,
      globalBotDisabled: !producer.botEnabled,
      customerMessageCount: _count.messages,
      // `lastMessageAt` can point at a bot/agent reply. The dedicated inbound
      // timestamp lets the web panel notify only when the customer wrote.
      lastInboundMessageAt: messages[0]?.createdAt ?? null,
    }))
  }

  async getMessages(conversationId: number, producerId: number, codeIds: number[]) {
    const conversation = await this.findAndVerify(conversationId, producerId, codeIds)
    const readAt = new Date()

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        createdAt: { lte: readAt, ...(conversation.sessionStartedAt ? { gte: conversation.sessionStartedAt } : {}) },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, rawData: true, createdAt: true },
    })

    // Do not clear a message that arrived after this fetch began. The
    // lastMessageAt guard makes opening a busy chat race-safe.
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: readAt } }] },
      data: { unreadCount: 0, lastReadAt: readAt },
    })

    return messages.map(({ rawData, ...message }) => ({ ...message, media: messageMedia(rawData) }))
  }

  async takeover(conversationId: number, producerId: number, codeIds: number[], userId: number) {
    // Fix #2: verify the conversation exists AND belongs to this producer before
    // touching anything — 404 for both "not found" and "wrong tenant" so we
    // don't leak cross-tenant existence.
    await this.findAndVerify(conversationId, producerId, codeIds)

    // Fix #1: atomic conditional update — only succeeds when nobody else has
    // claimed the conversation yet. updateMany gives us a WHERE-level check
    // that is evaluated as a single DB operation with no race window.
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        producerId,
        deletedAt: null,
        AND: codeScopeOr(codeIds),
        assignedToUserId: null, // ← guard: reject if already taken
      },
      data: {
        botPaused: true,
        assignedToUserId: userId,
        handedOverAt: new Date(),
        status: 'pending',
      },
    })

    if (result.count === 0) {
      // findAndVerify already confirmed existence, so count=0 means another
      // agent claimed it between our read and this write.
      throw new ConflictException('La conversación ya fue tomada por otro agente')
    }

    return this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId },
      select: CONVERSATION_SUMMARY_SELECT,
    })
  }

  async release(conversationId: number, producerId: number, codeIds: number[]) {
    // Fix #2: producerId is baked into findAndVerify's DB query.
    const conversation = await this.findAndVerify(conversationId, producerId, codeIds)

    await this.prisma.conversation.update({
      where: { id: conversationId },
      // flowState: null — the bot greets the customer from the menu instead of
      // resuming whatever step it was on before the human took over (the bot's
      // own reset-flow only clears an in-memory cache, not this snapshot).
      data: { botPaused: false, assignedToUserId: null, handedOverAt: null, status: 'open', flowState: null },
    })

    if (conversation.phoneNumberId) {
      await this.botNotifier.resetFlow(conversation.phoneNumberId, conversation.waId)
    }

    return { ok: true }
  }

  /**
   * Automatic counterpart of `release`, used when the operator stopped
   * answering (see BotTakeoverTimeoutService). Conditional on the conversation
   * still being paused, so it never races a manual release or undoes anything.
   * Returns whether it actually handed the conversation back.
   */
  async autoReleaseToBot(conversation: { id: number; phoneNumberId: string | null; waId: string }): Promise<boolean> {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversation.id, botPaused: true },
      // flowState: null — the bot greets the customer from the menu instead of
      // resuming whatever step it was on before the human took over (the bot's
      // own reset-flow only clears an in-memory cache, not this snapshot).
      data: { botPaused: false, assignedToUserId: null, handedOverAt: null, status: 'open', flowState: null },
    })
    if (count === 0) return false

    if (conversation.phoneNumberId) {
      await this.botNotifier.resetFlow(conversation.phoneNumberId, conversation.waId)
    }
    return true
  }

  async sendMessage(conversationId: number, producerId: number, codeIds: number[], userId: number, text: string) {
    // Fix #2: producerId in DB query, not post-fetch check.
    const conversation = await this.findAndVerify(conversationId, producerId, codeIds)

    if (!conversation.botPaused && conversation.producer.botEnabled) {
      throw new ForbiddenException('Take over the conversation before sending messages')
    }
    if (!conversation.phoneNumberId) {
      throw new BadRequestException('Conversation has no associated phone number')
    }

    // Fix #4: validate the Meta 24-hour messaging window server-side.
    // The front disables the input as UX, but only this check guarantees
    // consistency — it prevents persisting a message that Meta would reject.
    const lastUserMsg = await this.prisma.message.findFirst({
      where: { conversationId, role: 'user', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (!lastUserMsg || Date.now() - lastUserMsg.createdAt.getTime() > TWENTY_FOUR_HOURS_MS) {
      throw new BadRequestException('The 24-hour Meta messaging window has expired')
    }

    // Fix #3: deliver to WhatsApp FIRST — if the bot is down this throws and
    // nothing is persisted, so the agent sees an error instead of a ghost
    // bubble (message appears in the thread but never reached the user).
    await this.botNotifier.sendMessage(conversation.waId, text, conversation.phoneNumberId)

    // Persist after confirmed delivery and refresh lastMessageAt atomically.
    return this.prisma.$transaction(async tx => {
      const msg = await tx.message.create({
        data: { conversationId, role: 'agent', content: text },
        select: { id: true, role: true, content: true, createdAt: true },
      })
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: msg.createdAt },
      })
      return msg
    })
  }

  // ─── Helpers ───────────────────────────────────────────

  // Fix #2: producerId lives in the DB query — not a post-fetch application check.
  // This means a wrong-tenant :id is indistinguishable from a missing :id (both 404),
  // which is the correct behavior: we don't want to leak cross-tenant existence.
  private async findAndVerify(conversationId: number, producerId: number, codeIds: number[]) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, producerId, deletedAt: null, AND: codeScopeOr(codeIds) },
      select: {
        id: true,
        waId: true,
        producerId: true,
        botPaused: true,
        producer: { select: { botEnabled: true } },
        phoneNumberId: true,
        sessionStartedAt: true,
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return conversation
  }
}
