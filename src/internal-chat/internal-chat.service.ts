import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InternalChatKind, Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { FEATURE_NOT_IN_PLAN } from '../plan-features/plan-features'
import { PlanFeaturesService } from '../plan-features/plan-features.service'
import {
  ListInternalChatMessagesDto,
  MarkInternalChatReadDto,
  OpenDirectChatDto,
  PAGE_DEFAULT,
  SendInternalChatMessageDto,
} from './dto/internal-chat.dto'

/** The signed-in person, as the controller passes it. */
export interface ChatActor {
  id: number
  producerId: number
  role?: Role
}

const TEAM_KEY = 'team'
// How long a plan check is reused for the same organization.
const PLAN_CHECK_TTL_MS = 30_000

/** One direct chat per pair, whoever opens it first. */
function directKey(a: number, b: number): string {
  return `direct:${Math.min(a, b)}:${Math.max(a, b)}`
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002'
}

const PERSON_SELECT = { id: true, name: true, email: true } as const

const MEMBER_SELECT = { id: true, lastReadMessageId: true } as const

const MESSAGE_SELECT = {
  id: true,
  chatId: true,
  body: true,
  createdAt: true,
  sender: { select: PERSON_SELECT },
} as const

export type ChatPerson = Prisma.UserGetPayload<{ select: typeof PERSON_SELECT }>
export type ChatMessage = Prisma.InternalChatMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

export interface InternalChatSummary {
  id: number
  kind: InternalChatKind
  /** The other person of a direct chat; null for the team chat. */
  person: ChatPerson | null
  lastMessage: ChatMessage | null
  lastMessageAt: Date | null
  /** Messages from others after the last one this person read. */
  unread: number
}

export interface InternalChatPage {
  /** Oldest first. */
  messages: ChatMessage[]
  /** There are older messages before the first one. */
  hasMore: boolean
  /** How far each person in the chat has read, for the "Visto" marks. */
  members: { user: ChatPerson; lastReadMessageId: number | null }[]
}

export interface InternalChatUnread {
  total: number
  /** The newest unread message, for the "new message" notice. */
  latest: ChatMessage | null
}

interface ChatRead {
  chatId: number
  lastReadMessageId: number | null
}

/**
 * "Chat interno": messages between the panel users of an organization, apart
 * from the WhatsApp chats with clients. Each organization has a team chat that
 * everyone in the office is part of, plus a direct chat per pair of people.
 * The platform OWNER is not part of any office's chat.
 */
@Injectable()
export class InternalChatService {
  // Whether each organization's plans include the chat, for a short while: the
  // panel polls every few seconds and the plans change rarely.
  private readonly allowedCache = new Map<number, { allowed: boolean; until: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly planFeatures: PlanFeaturesService,
  ) {}

  /** Coworkers one can write to: the organization's users, oneself and the OWNER excluded. */
  async people(actor: ChatActor): Promise<ChatPerson[]> {
    await this.assertAllowed(actor)
    return this.prisma.user.findMany({
      where: { producerId: actor.producerId, deletedAt: null, role: { not: Role.OWNER }, id: { not: actor.id } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: PERSON_SELECT,
    })
  }

  /** The team chat first, then the direct chats with the latest activity first. */
  async listChats(actor: ChatActor): Promise<InternalChatSummary[]> {
    await this.assertAllowed(actor)
    await this.ensureTeamMember(actor)
    return this.summaries(actor)
  }

  /** The direct chat with that person, created the first time either of them opens it. */
  async openDirect(actor: ChatActor, dto: OpenDirectChatDto): Promise<InternalChatSummary> {
    await this.assertAllowed(actor)
    if (dto.userId === actor.id) throw new BadRequestException('A direct chat needs someone else')
    const person = await this.prisma.user.findFirst({
      where: { id: dto.userId, producerId: actor.producerId, deletedAt: null, role: { not: Role.OWNER } },
      select: { id: true },
    })
    if (!person) throw new BadRequestException('That person is not part of this office')

    const key = directKey(actor.id, dto.userId)
    const existing = await this.prisma.internalChat.findUnique({
      where: { producerId_key: { producerId: actor.producerId, key } },
      select: { id: true },
    })
    const chatId = existing?.id ?? (await this.createDirectChat(actor.producerId, key, [actor.id, dto.userId]))
    const [summary] = await this.summaries(actor, chatId)
    return summary
  }

  /** A page of the chat, newest last, and how far each member has read. */
  async messages(actor: ChatActor, chatId: number, dto: ListInternalChatMessagesDto): Promise<InternalChatPage> {
    await this.findMembership(actor, chatId)
    const limit = dto.limit ?? PAGE_DEFAULT
    const [rows, members] = await Promise.all([
      this.prisma.internalChatMessage.findMany({
        where: { chatId, deletedAt: null, ...(dto.beforeId ? { id: { lt: dto.beforeId } } : {}) },
        orderBy: { id: 'desc' },
        take: limit + 1,
        select: MESSAGE_SELECT,
      }),
      this.prisma.internalChatMember.findMany({
        where: { chatId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: { lastReadMessageId: true, user: { select: PERSON_SELECT } },
      }),
    ])
    return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit, members }
  }

  async send(actor: ChatActor, chatId: number, dto: SendInternalChatMessageDto): Promise<ChatMessage> {
    const member = await this.findMembership(actor, chatId)
    return this.prisma.$transaction(async tx => {
      const message = await tx.internalChatMessage.create({
        data: { chatId, senderId: actor.id, body: dto.body },
        select: MESSAGE_SELECT,
      })
      await tx.internalChat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } })
      // Whoever writes has read the chat up to their own message.
      await tx.internalChatMember.update({ where: { id: member.id }, data: { lastReadMessageId: message.id } })
      return message
    })
  }

  /** Moves the reader's mark up to that message (never back). */
  async markRead(
    actor: ChatActor,
    chatId: number,
    dto: MarkInternalChatReadDto,
  ): Promise<{ lastReadMessageId: number | null }> {
    const member = await this.findMembership(actor, chatId)
    const message = await this.prisma.internalChatMessage.findFirst({
      where: { id: dto.messageId, chatId },
      select: { id: true },
    })
    if (!message) throw new BadRequestException('That message is not part of this chat')
    const { count } = await this.prisma.internalChatMember.updateMany({
      where: { id: member.id, OR: [{ lastReadMessageId: null }, { lastReadMessageId: { lt: message.id } }] },
      data: { lastReadMessageId: message.id },
    })
    return { lastReadMessageId: count > 0 ? message.id : member.lastReadMessageId }
  }

  /** Soft-deletes one of the person's own messages: it stops showing in the chat. */
  async removeMessage(actor: ChatActor, messageId: number): Promise<{ ok: true }> {
    await this.assertAllowed(actor)
    const message = await this.prisma.internalChatMessage.findFirst({
      where: {
        id: messageId,
        senderId: actor.id,
        deletedAt: null,
        chat: { producerId: actor.producerId, deletedAt: null },
      },
      select: { id: true },
    })
    if (!message) throw new NotFoundException(`Message ${messageId} not found`)
    await this.prisma.internalChatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  /** Menu badge and new-message notice: unread messages across all the person's chats. */
  async unread(actor: ChatActor): Promise<InternalChatUnread> {
    await this.assertAllowed(actor)
    await this.ensureTeamMember(actor)
    const reads = await this.prisma.internalChatMember.findMany({
      where: { userId: actor.id, deletedAt: null, chat: { producerId: actor.producerId, deletedAt: null } },
      select: { chatId: true, lastReadMessageId: true },
    })
    if (reads.length === 0) return { total: 0, latest: null }
    const where = this.unreadWhere(actor, reads)
    const [total, latest] = await Promise.all([
      this.prisma.internalChatMessage.count({ where }),
      this.prisma.internalChatMessage.findFirst({ where, orderBy: { id: 'desc' }, select: MESSAGE_SELECT }),
    ])
    return { total, latest }
  }

  /** The office's chat, when the plans of the organization's numbers include it (`internal_chat`). */
  private async assertAllowed(actor: ChatActor): Promise<void> {
    if (actor.role === Role.OWNER) throw new ForbiddenException('The internal chat is for the office')
    const now = Date.now()
    let cached = this.allowedCache.get(actor.producerId)
    if (!cached || cached.until <= now) {
      const allowed = await this.planFeatures.hasFeature(actor.producerId, 'internal_chat')
      cached = { allowed, until: now + PLAN_CHECK_TTL_MS }
      this.allowedCache.set(actor.producerId, cached)
    }
    if (!cached.allowed) throw new ForbiddenException(FEATURE_NOT_IN_PLAN.internal_chat)
  }

  private async summaries(actor: ChatActor, chatId?: number): Promise<InternalChatSummary[]> {
    const memberships = await this.prisma.internalChatMember.findMany({
      where: {
        userId: actor.id,
        deletedAt: null,
        ...(chatId ? { chatId } : {}),
        chat: { producerId: actor.producerId, deletedAt: null },
      },
      select: {
        lastReadMessageId: true,
        chat: {
          select: {
            id: true,
            kind: true,
            lastMessageAt: true,
            members: {
              where: { deletedAt: null, userId: { not: actor.id } },
              select: { user: { select: PERSON_SELECT } },
            },
            messages: { where: { deletedAt: null }, orderBy: { id: 'desc' }, take: 1, select: MESSAGE_SELECT },
          },
        },
      },
    })
    const unread = await this.unreadByChat(
      actor,
      memberships.map(m => ({ chatId: m.chat.id, lastReadMessageId: m.lastReadMessageId })),
    )
    return memberships
      .map(({ chat }) => ({
        id: chat.id,
        kind: chat.kind,
        person: chat.kind === InternalChatKind.DIRECT ? (chat.members[0]?.user ?? null) : null,
        lastMessage: chat.messages[0] ?? null,
        lastMessageAt: chat.lastMessageAt,
        unread: unread.get(chat.id) ?? 0,
      }))
      .sort(compareChats)
  }

  private async unreadByChat(actor: ChatActor, reads: ChatRead[]): Promise<Map<number, number>> {
    if (reads.length === 0) return new Map()
    const rows = await this.prisma.internalChatMessage.groupBy({
      by: ['chatId'],
      where: this.unreadWhere(actor, reads),
      _count: { _all: true },
    })
    return new Map(rows.map(row => [row.chatId, row._count._all]))
  }

  /** Messages from others after each chat's read mark. */
  private unreadWhere(actor: ChatActor, reads: ChatRead[]): Prisma.InternalChatMessageWhereInput {
    return {
      deletedAt: null,
      senderId: { not: actor.id },
      OR: reads.map(read => ({ chatId: read.chatId, id: { gt: read.lastReadMessageId ?? 0 } })),
    }
  }

  /** The chat, if the person is in it. Someone else's direct chat is "not found". */
  private async findMembership(actor: ChatActor, chatId: number) {
    await this.assertAllowed(actor)
    const chat = await this.prisma.internalChat.findFirst({
      where: { id: chatId, producerId: actor.producerId, deletedAt: null },
      select: { kind: true, members: { where: { userId: actor.id, deletedAt: null }, select: MEMBER_SELECT } },
    })
    if (!chat) throw new NotFoundException(`Chat ${chatId} not found`)
    if (chat.members[0]) return chat.members[0]
    if (chat.kind !== InternalChatKind.TEAM) throw new NotFoundException(`Chat ${chatId} not found`)
    await this.ensureTeamMember(actor)
    return this.prisma.internalChatMember.findUniqueOrThrow({
      where: { chatId_userId: { chatId, userId: actor.id } },
      select: MEMBER_SELECT,
    })
  }

  /** Makes sure the organization's team chat exists and the person has their row in it. */
  private async ensureTeamMember(actor: ChatActor): Promise<void> {
    const team = await this.prisma.internalChat.findUnique({
      where: { producerId_key: { producerId: actor.producerId, key: TEAM_KEY } },
      select: { id: true, members: { where: { userId: actor.id }, select: { id: true } } },
    })
    if (team?.members.length) return
    const chatId = team?.id ?? (await this.createTeamChat(actor.producerId))
    await this.joinTeam(actor, chatId)
  }

  private async createTeamChat(producerId: number): Promise<number> {
    try {
      const chat = await this.prisma.internalChat.create({
        data: { producerId, kind: InternalChatKind.TEAM, key: TEAM_KEY },
        select: { id: true },
      })
      return chat.id
    } catch (error) {
      // Someone else of the office opened the chat at the same moment.
      if (!isUniqueViolation(error)) throw error
      const chat = await this.prisma.internalChat.findUniqueOrThrow({
        where: { producerId_key: { producerId, key: TEAM_KEY } },
        select: { id: true },
      })
      return chat.id
    }
  }

  /** What the team wrote before the person had a user is history, not news for them. */
  private async joinTeam(actor: ChatActor, chatId: number): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { createdAt: true } })
    const before = await this.prisma.internalChatMessage.findFirst({
      where: { chatId, createdAt: { lt: user.createdAt } },
      orderBy: { id: 'desc' },
      select: { id: true },
    })
    try {
      await this.prisma.internalChatMember.create({
        data: { chatId, userId: actor.id, lastReadMessageId: before?.id ?? null },
      })
    } catch (error) {
      // Two requests of the same person raced to add their row: one is enough.
      if (!isUniqueViolation(error)) throw error
    }
  }

  private async createDirectChat(producerId: number, key: string, userIds: number[]): Promise<number> {
    try {
      const chat = await this.prisma.internalChat.create({
        data: {
          producerId,
          kind: InternalChatKind.DIRECT,
          key,
          members: { create: userIds.map(userId => ({ userId })) },
        },
        select: { id: true },
      })
      return chat.id
    } catch (error) {
      // The other person opened it at the same moment.
      if (!isUniqueViolation(error)) throw error
      const chat = await this.prisma.internalChat.findUniqueOrThrow({
        where: { producerId_key: { producerId, key } },
        select: { id: true },
      })
      return chat.id
    }
  }
}

function compareChats(a: InternalChatSummary, b: InternalChatSummary): number {
  if (a.kind !== b.kind) return a.kind === InternalChatKind.TEAM ? -1 : 1
  const at = a.lastMessageAt?.getTime() ?? 0
  const bt = b.lastMessageAt?.getTime() ?? 0
  if (at !== bt) return bt - at
  return (a.person?.name ?? a.person?.email ?? '').localeCompare(b.person?.name ?? b.person?.email ?? '')
}
