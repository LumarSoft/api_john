import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BotNotifierService } from './bot-notifier.service'
import { ListInboxDto } from './dto/list-inbox.dto'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

const CONVERSATION_SUMMARY_SELECT = {
  id: true,
  waId: true,
  status: true,
  botPaused: true,
  assignedToUserId: true,
  assignedTo: { select: { id: true, email: true } },
  handedOverAt: true,
  lastMessageAt: true,
  sessionStartedAt: true,
  phoneNumberId: true,
  client: { select: { id: true, firstName: true, lastName: true, dni: true } },
} as const

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifier: BotNotifierService,
  ) {}

  async listConversations(producerId: number, dto: ListInboxDto) {
    const statusFilter = dto.status ? [dto.status] : ['open', 'pending']
    const search = dto.search?.trim()

    return this.prisma.conversation.findMany({
      where: {
        producerId,
        deletedAt: null,
        status: { in: statusFilter },
        ...(search
          ? {
              OR: [
                { client: { firstName: { contains: search } } },
                { client: { lastName: { contains: search } } },
                { client: { dni: { contains: search } } },
                { waId: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [
        // "pending" (user requested agent) sorts before "open" alphabetically.
        { status: 'desc' },
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      ],
      select: CONVERSATION_SUMMARY_SELECT,
    })
  }

  async getMessages(conversationId: number, producerId: number) {
    const conversation = await this.findAndVerify(conversationId, producerId)

    return this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(conversation.sessionStartedAt ? { createdAt: { gte: conversation.sessionStartedAt } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    })
  }

  async takeover(conversationId: number, producerId: number, userId: number) {
    // Fix #2: verify the conversation exists AND belongs to this producer before
    // touching anything — 404 for both "not found" and "wrong tenant" so we
    // don't leak cross-tenant existence.
    await this.findAndVerify(conversationId, producerId)

    // Fix #1: atomic conditional update — only succeeds when nobody else has
    // claimed the conversation yet. updateMany gives us a WHERE-level check
    // that is evaluated as a single DB operation with no race window.
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        producerId,
        deletedAt: null,
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

  async release(conversationId: number, producerId: number) {
    // Fix #2: producerId is baked into findAndVerify's DB query.
    const conversation = await this.findAndVerify(conversationId, producerId)

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { botPaused: false, assignedToUserId: null, handedOverAt: null, status: 'open' },
    })

    if (conversation.phoneNumberId) {
      await this.botNotifier.resetFlow(conversation.phoneNumberId, conversation.waId)
    }

    return { ok: true }
  }

  async sendMessage(conversationId: number, producerId: number, userId: number, text: string) {
    // Fix #2: producerId in DB query, not post-fetch check.
    const conversation = await this.findAndVerify(conversationId, producerId)

    if (!conversation.botPaused) {
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
  private async findAndVerify(conversationId: number, producerId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, producerId, deletedAt: null },
      select: {
        id: true,
        waId: true,
        producerId: true,
        botPaused: true,
        phoneNumberId: true,
        sessionStartedAt: true,
      },
    })
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`)
    return conversation
  }
}
