import { Injectable, NotFoundException } from '@nestjs/common'
import { AssistantMessageRole, Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import { AssistantActionsService } from './assistant-actions.service'
import { ActionView } from './tools/tool.types'

/** What a message keeps besides its text. */
export interface MessageBlocks {
  /** The steps the assistant took ("Revisando los datos de pago"). */
  steps?: string[]
  /** The actions it proposed in this answer. */
  actions?: number[]
}

export interface MessageView {
  id: number
  role: 'user' | 'assistant'
  content: string
  steps: string[]
  actions: ActionView[]
  createdAt: string
}

export interface ConversationSummary {
  id: number
  title: string
  updatedAt: string
}

/** How many past messages the model reads: the latest ones. */
const HISTORY = 20
const LIST_LIMIT = 30
const TITLE_MAX = 80

const ACTION_OUTCOME: Record<ActionView['status'], string> = {
  pending: 'todavía sin confirmar',
  confirmed: 'la persona la confirmó y se aplicó',
  cancelled: 'la persona la canceló',
  failed: 'la persona la confirmó pero falló',
  expired: 'venció sin que la confirmen',
}

/** A person's conversations with the assistant: only they see theirs. */
@Injectable()
export class AssistantConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: AssistantActionsService,
    private readonly scope: ScopeService,
  ) {}

  async list(user: ScopeUser): Promise<ConversationSummary[]> {
    const [rows, current] = await Promise.all([
      this.prisma.assistantConversation.findMany({
        where: { userId: user.id, producerId: user.producerId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: LIST_LIMIT,
        select: { id: true, title: true, updatedAt: true, scopeKey: true },
      }),
      this.scopeKeyOf(user),
    ])
    return rows
      .filter(r => fitsScope(r.scopeKey, current))
      .map(r => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
  }

  async get(user: ScopeUser, id: number, now = new Date()) {
    const conversation = await this.findOwn(user, id)
    const [messages, actions] = await Promise.all([
      this.prisma.assistantMessage.findMany({
        where: { conversationId: id, deletedAt: null },
        orderBy: { id: 'asc' },
        select: { id: true, role: true, content: true, blocks: true, createdAt: true },
      }),
      this.actions.viewsFor(id, now),
    ])
    return {
      id: conversation.id,
      title: conversation.title,
      messages: messages.map(m => toMessageView(m, actions)),
    }
  }

  async create(user: ScopeUser, firstQuestion: string): Promise<ConversationSummary> {
    const row = await this.prisma.assistantConversation.create({
      data: {
        title: titleOf(firstQuestion),
        userId: user.id,
        producerId: user.producerId,
        scopeKey: await this.scopeKeyOf(user),
      },
      select: { id: true, title: true, updatedAt: true },
    })
    return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }
  }

  async remove(user: ScopeUser, id: number): Promise<{ deleted: true }> {
    await this.findOwn(user, id)
    await this.prisma.assistantConversation.update({ where: { id }, data: { deletedAt: new Date() } })
    return { deleted: true }
  }

  async findOwn(user: ScopeUser, id: number) {
    const conversation = await this.prisma.assistantConversation.findFirst({
      where: { id, userId: user.id, producerId: user.producerId, deletedAt: null },
      select: { id: true, title: true, scopeKey: true },
    })
    if (!conversation || !fitsScope(conversation.scopeKey, await this.scopeKeyOf(user))) {
      throw new NotFoundException('No encontré esa conversación.')
    }
    return { id: conversation.id, title: conversation.title }
  }

  /** The person's role and, for an admin, the codes they see now (see AssistantConversation.scopeKey). */
  private async scopeKeyOf(user: ScopeUser): Promise<string> {
    const role = user.role ?? Role.ADMIN
    if (role !== Role.ADMIN) return role
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
    return `${Role.ADMIN}:${[...codeIds].sort((a, b) => a - b).join(',')}`
  }

  /**
   * The question to answer. A retry of the last question that got no answer
   * (the same text, last in the chat) reuses it instead of repeating it.
   */
  async addQuestion(conversationId: number, content: string): Promise<number> {
    const last = await this.prisma.assistantMessage.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { id: 'desc' },
      select: { id: true, role: true, content: true },
    })
    if (last?.role === AssistantMessageRole.USER && last.content === content) return last.id
    return this.add(conversationId, AssistantMessageRole.USER, content)
  }

  async addAnswer(
    conversationId: number,
    content: string,
    blocks: MessageBlocks,
    now = new Date(),
  ): Promise<MessageView> {
    const id = await this.add(conversationId, AssistantMessageRole.ASSISTANT, content, blocks)
    const row = await this.prisma.assistantMessage.findUniqueOrThrow({
      where: { id },
      select: { id: true, role: true, content: true, blocks: true, createdAt: true },
    })
    return toMessageView(row, await this.actions.viewsFor(conversationId, now))
  }

  /**
   * The latest messages as the model reads them. Each answer that proposed an
   * action says what became of it, with the exact values before and after, so
   * "¿ya está?" gets the real answer and "volvé a dejarlo como estaba" restores
   * the real previous value, not the model's summary of it.
   */
  async historyForModel(
    conversationId: number,
    now = new Date(),
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const [rows, actions] = await Promise.all([
      this.prisma.assistantMessage.findMany({
        where: { conversationId, deletedAt: null },
        orderBy: { id: 'desc' },
        take: HISTORY,
        select: { role: true, content: true, blocks: true },
      }),
      this.actions.viewsFor(conversationId, now),
    ])
    return rows.reverse().map(row => {
      const ids = blocksOf(row.blocks).actions ?? []
      const outcomes = ids
        .map(id => actions.get(id))
        .filter((a): a is ActionView => a != null)
        .map(a => {
          const changes = a.preview.changes
            .map(c => `${c.label}: «${c.before ?? 'vacío'}» → «${c.after ?? 'vacío'}»`)
            .join('; ')
          return `[Propuesta #${a.id}, ${a.preview.title} (${a.preview.target}): ${ACTION_OUTCOME[a.status]}${a.error ? ` (${a.error})` : ''}. ${changes}]`
        })
      return {
        role: row.role === AssistantMessageRole.USER ? 'user' : 'assistant',
        content: outcomes.length ? `${row.content}\n\n${outcomes.join('\n')}` : row.content,
      }
    })
  }

  private async add(
    conversationId: number,
    role: AssistantMessageRole,
    content: string,
    blocks?: MessageBlocks,
  ): Promise<number> {
    const [message] = await this.prisma.$transaction([
      this.prisma.assistantMessage.create({
        data: {
          conversationId,
          role,
          content,
          ...(blocks ? { blocks: blocks as unknown as Prisma.InputJsonObject } : {}),
        },
        select: { id: true },
      }),
      this.prisma.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ])
    return message.id
  }
}

function blocksOf(value: Prisma.JsonValue): MessageBlocks {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as MessageBlocks) : {}
}

function toMessageView(
  row: { id: number; role: AssistantMessageRole; content: string; blocks: Prisma.JsonValue; createdAt: Date },
  actions: Map<number, ActionView>,
): MessageView {
  const blocks = blocksOf(row.blocks)
  return {
    id: row.id,
    role: row.role === AssistantMessageRole.USER ? 'user' : 'assistant',
    content: row.content,
    steps: blocks.steps ?? [],
    actions: (blocks.actions ?? []).map(id => actions.get(id)).filter((a): a is ActionView => a != null),
    createdAt: row.createdAt.toISOString(),
  }
}

/** The first question, on one line and short: what the history list shows. */
export function titleOf(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
}

/**
 * Whether a conversation started as `stored` may be read by the person as
 * they are now (`current`): same role and, for an admin, still every code
 * they had then. Gaining codes keeps it; losing one closes it.
 */
export function fitsScope(stored: string | null, current: string): boolean {
  if (stored == null) return true
  const [storedRole, storedCodes = ''] = stored.split(':')
  const [currentRole, currentCodes = ''] = current.split(':')
  if (storedRole !== currentRole) return false
  const now = new Set(currentCodes.split(',').filter(Boolean))
  return storedCodes
    .split(',')
    .filter(Boolean)
    .every(code => now.has(code))
}
