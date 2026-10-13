import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConversationStatus, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isSamePhone } from '../common/phone-match'
import { signAdjuntoUrl } from '../siniestros/adjunto-url'
import { INBOX_PUBLIC_PREFIX, MAX_OUTGOING_IMAGE_SIZE } from '../siniestros/siniestro-upload.config'
import { unlink } from 'fs/promises'
import { BotNotifierService } from './bot-notifier.service'
import { ListInboxDto } from './dto/list-inbox.dto'
import { NovedadType } from '../novedades/dto/list-novedades.dto'
import { UpdateInboxContactDto } from './dto/update-inbox-contact.dto'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// The thread shows the whole stored history (live messages are kept
// MESSAGE_RETENTION_DAYS); the cap only bounds the 3-second poll on chats with
// a long Coexistence backfill.
const MAX_THREAD_MESSAGES = 500

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
  contactName: true,
  contactNameManual: true,
  client: { select: { id: true, firstName: true, lastName: true, dni: true, phone: true } },
} as const

type ConversationContact = {
  waId: string
  contactName: string | null
  contactNameManual: string | null
  client: { phone: string | null } | null
}

/**
 * Who is writing vs. which client the chat is about. A relative can identify
 * with the holder's DNI; the inbox must keep showing the writer and only note
 * the client they asked about. `clientIsContact` is true when the linked
 * client's stored phone is this WhatsApp number.
 */
function withContact<T extends ConversationContact>(conversation: T, agendaName?: string | null) {
  const { client, ...rest } = conversation
  return {
    ...rest,
    // A name set by hand in the inbox wins: it is how an advisor fixes a chat
    // shown under the wrong person.
    contactName: conversation.contactNameManual ?? agendaName ?? conversation.contactName,
    client: client ? { ...client, phone: undefined } : null,
    clientIsContact: client ? isSamePhone(conversation.waId, client.phone) : false,
  }
}

const CONVERSATION_LIST_SELECT = {
  ...CONVERSATION_SUMMARY_SELECT,
  producer: { select: { botEnabled: true } },
  // The latest message of any role feeds the list preview; the latest inbound
  // one is read separately (see lastInboundByConversation).
  messages: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { role: true, content: true, rawData: true, createdAt: true },
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

const PREVIEW_MAX_LENGTH = 120

/** What the conversation list shows under the contact name, like WhatsApp. */
function lastMessagePreview(
  message: { role: string; content: string; rawData: Prisma.JsonValue | null; createdAt: Date } | undefined,
) {
  if (!message) return null
  const mimeType = messageMedia(message.rawData)?.mimeType ?? null
  const content = message.content.replace(/\s+/g, ' ').trim()
  return {
    role: message.role,
    content: content.length > PREVIEW_MAX_LENGTH ? `${content.slice(0, PREVIEW_MAX_LENGTH)}…` : content,
    mediaType: mimeType?.startsWith('image/')
      ? 'image'
      : mimeType?.startsWith('audio/')
        ? 'audio'
        : mimeType
          ? 'file'
          : null,
    createdAt: message.createdAt,
  }
}

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifier: BotNotifierService,
  ) {}

  async listConversations(producerId: number, codeIds: number[], dto: ListInboxDto, metaPhoneNumberId?: string | null) {
    const statusFilter: ConversationStatus[] = dto.status ? [dto.status] : ['open', 'pending']
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
                    { contactName: { contains: search } },
                  ],
                } as Prisma.ConversationWhereInput,
              ]
            : []),
        ],
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: CONVERSATION_LIST_SELECT,
    })

    const [agenda, lastInbound] = await Promise.all([
      this.agendaNames(producerId, conversations),
      this.lastInboundByConversation(conversations.map(c => c.id)),
    ])

    return conversations.map(({ messages, producer, _count, ...conversation }) => ({
      ...withContact(conversation, agenda.get(`${conversation.phoneNumberId}:${conversation.waId}`)),
      globalBotDisabled: !producer.botEnabled,
      customerMessageCount: _count.messages,
      // `lastMessageAt` can point at a bot/agent reply. The dedicated inbound
      // timestamp lets the web panel notify only when the customer wrote.
      lastInboundMessageAt: lastInbound.get(conversation.id) ?? null,
      lastMessage: lastMessagePreview(messages[0]),
    }))
  }

  private async lastInboundByConversation(conversationIds: number[]): Promise<Map<number, Date>> {
    if (!conversationIds.length) return new Map()
    const rows = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds }, role: 'user', deletedAt: null },
      _max: { createdAt: true },
    })
    return new Map(rows.flatMap(row => (row._max.createdAt ? [[row.conversationId, row._max.createdAt]] : [])))
  }

  async getMessages(conversationId: number, producerId: number, codeIds: number[]) {
    await this.findAndVerify(conversationId, producerId, codeIds)
    const readAt = new Date()

    // Not limited to the bot session: the session boundary moves after a few
    // idle minutes, and filtering by it hid every earlier conversation.
    const latest = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null, createdAt: { lte: readAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_THREAD_MESSAGES,
      select: { id: true, role: true, content: true, rawData: true, createdAt: true },
    })
    const messages = latest.reverse()

    // Do not clear a message that arrived after this fetch began. The
    // lastMessageAt guard makes opening a busy chat race-safe.
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: readAt } }] },
      data: { unreadCount: 0, lastReadAt: readAt },
    })

    return messages.map(({ rawData, ...message }) => ({ ...message, media: messageMedia(rawData) }))
  }

  /** Explicit deletion of ephemeral chats. Business records remain intact. */
  async deleteConversations(producerId: number, codeIds: number[], conversationId?: number) {
    const deleted = await this.prisma.$transaction(async tx => {
      const where: Prisma.ConversationWhereInput = {
        producerId,
        deletedAt: null,
        AND: codeScopeOr(codeIds),
        ...(conversationId !== undefined ? { id: conversationId } : {}),
      }
      const conversations = await tx.conversation.findMany({
        where,
        select: { id: true, phoneNumberId: true, waId: true },
      })
      if (conversationId !== undefined && conversations.length === 0) {
        throw new NotFoundException('Conversation not found')
      }
      if (!conversations.length) return conversations
      const ids = conversations.map(c => c.id)
      // Lock the selected rows before removing their history, so a concurrent
      // bot turn cannot recreate a deleted transcript inside this transaction.
      await tx.conversation.updateMany({ where: { ...where, id: { in: ids } }, data: { flowState: null } })
      await tx.contactLead.updateMany({
        where: { producerId, conversationId: { in: ids } },
        data: { conversationId: null },
      })
      await tx.notification.updateMany({
        where: { producerId, type: NovedadType.HANDOFF, refId: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      await tx.message.deleteMany({ where: { conversationId: { in: ids } } })
      await tx.conversation.deleteMany({ where: { ...where, id: { in: ids } } })
      return conversations
    })
    // Flow snapshots are also deleted above; notification is best-effort.
    for (const c of deleted) {
      if (c.phoneNumberId) await this.botNotifier.resetFlow(c.phoneNumberId, c.waId)
    }
    return { deletedCount: deleted.length }
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

    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId },
      select: CONVERSATION_SUMMARY_SELECT,
    })
    return withContact(conversation)
  }

  /**
   * Manual fix of who a chat belongs to: the name shown for the writer and,
   * optionally, dropping a client linked by mistake (a relative who asked with
   * the holder's DNI). Unlinking also makes the bot ask for identification on
   * the next message instead of serving that client's data.
   */
  async updateContact(conversationId: number, producerId: number, codeIds: number[], dto: UpdateInboxContactDto) {
    await this.findAndVerify(conversationId, producerId, codeIds)

    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.contactName !== undefined ? { contactNameManual: dto.contactName?.trim() || null } : {}),
        ...(dto.unlinkClient ? { clientId: null, clientLinkedAt: null } : {}),
      },
      select: CONVERSATION_SUMMARY_SELECT,
    })
    return withContact(conversation)
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
    const conversation = await this.assertCanSend(conversationId, producerId, codeIds)

    // Fix #3: deliver to WhatsApp FIRST — if the bot is down this throws and
    // nothing is persisted, so the agent sees an error instead of a ghost
    // bubble (message appears in the thread but never reached the user).
    await this.botNotifier.sendMessage(conversation.waId, text, conversation.phoneNumberId)

    return this.persistAgentMessage(conversationId, text)
  }

  /**
   * A photo (JPEG/PNG) or PDF sent from the panel, with an optional caption.
   * Same rules as a text reply; the file is removed again if it can't be sent.
   */
  async sendMedia(
    conversationId: number,
    producerId: number,
    codeIds: number[],
    file: Express.Multer.File | undefined,
    caption?: string,
  ) {
    if (!file) throw new BadRequestException('A file is required')
    try {
      const isImage = file.mimetype.startsWith('image/')
      if (isImage && file.size > MAX_OUTGOING_IMAGE_SIZE) {
        throw new BadRequestException('WhatsApp only accepts photos up to 5 MB')
      }
      const conversation = await this.assertCanSend(conversationId, producerId, codeIds)
      // Multer reads multipart filenames as latin1; WhatsApp shows the name to the client.
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
      const text = caption?.trim() ?? ''

      await this.botNotifier.sendMedia({
        to: conversation.waId,
        phoneNumberId: conversation.phoneNumberId,
        path: file.path,
        mimeType: file.mimetype,
        filename: originalName,
        caption: text || undefined,
      })

      const media = {
        url: `${INBOX_PUBLIC_PREFIX}/${file.filename}`,
        originalName,
        mimeType: file.mimetype,
        size: file.size,
      }
      // A bracketed placeholder, like the bot's, when there is no caption.
      const content = text || (isImage ? '[foto]' : `[documento ${originalName}]`)
      const message = await this.persistAgentMessage(conversationId, content, { media })
      return { ...message, media: messageMedia({ media }) }
    } catch (error) {
      await unlink(file.path).catch(() => undefined)
      throw error
    }
  }

  /** Checks shared by every reply from the panel; returns the conversation. */
  private async assertCanSend(conversationId: number, producerId: number, codeIds: number[]) {
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
    return { ...conversation, phoneNumberId: conversation.phoneNumberId }
  }

  /** Persists a delivered reply and refreshes lastMessageAt atomically. */
  private persistAgentMessage(conversationId: number, content: string, rawData?: Prisma.InputJsonValue) {
    return this.prisma.$transaction(async tx => {
      const msg = await tx.message.create({
        data: { conversationId, role: 'agent', content, ...(rawData ? { rawData } : {}) },
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

  /**
   * Names the office saved in the WhatsApp Business address book (Coexistence
   * contacts), keyed by `${metaPhoneNumberId}:${waId}`. They win over the
   * customer's own WhatsApp profile name.
   */
  private async agendaNames(
    producerId: number,
    conversations: Array<{ waId: string; phoneNumberId: string | null }>,
  ): Promise<Map<string, string>> {
    const waIds = [...new Set(conversations.map(c => c.waId))]
    if (!waIds.length) return new Map()

    const contacts = await this.prisma.whatsAppContact.findMany({
      where: {
        deletedAt: null,
        fullName: { not: null },
        phoneNumber: { producerId },
        OR: [{ waId: { in: waIds } }, { phone: { in: waIds } }],
      },
      select: { waId: true, phone: true, fullName: true, phoneNumber: { select: { phoneNumberId: true } } },
    })

    const names = new Map<string, string>()
    for (const contact of contacts) {
      const name = contact.fullName?.trim()
      if (!name) continue
      names.set(`${contact.phoneNumber.phoneNumberId}:${contact.waId ?? contact.phone}`, name)
    }
    return names
  }

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
