import { ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AssistantActionStatus, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import {
  ActionExecutor,
  ActionLink,
  ActionPreview,
  ActionStatus,
  ActionView,
  ToolContext,
  ToolError,
} from './tools/tool.types'

/** How long a proposal waits for the person: after that it has to be asked again, with fresh data. */
const PROPOSAL_TTL_MS = 30 * 60_000

type ActionRow = {
  id: number
  type: string
  status: AssistantActionStatus
  payload: Prisma.JsonValue
  preview: Prisma.JsonValue
  result: Prisma.JsonValue
  error: string | null
  expiresAt: Date
}

const VIEW_SELECT = {
  id: true,
  type: true,
  status: true,
  payload: true,
  preview: true,
  result: true,
  error: true,
  expiresAt: true,
} satisfies Prisma.AssistantActionSelect

/** What confirming returns to the panel: the card as it is now and which screens to refresh. */
export interface ConfirmResult {
  action: ActionView
  refresh: string[]
}

/**
 * Changes the assistant prepares and only the person runs. A tool stores the
 * exact payload and what the card shows; tapping "Confirmar" runs it through
 * the same service the panel's own form uses, with the confirming user's
 * permissions, so the assistant can never do more than the person could by
 * hand. Each proposal runs at most once.
 */
@Injectable()
export class AssistantActionsService {
  private readonly logger = new Logger(AssistantActionsService.name)
  private readonly executors = new Map<string, ActionExecutor>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  register(executors: ActionExecutor[]): void {
    for (const executor of executors) this.executors.set(executor.type, executor)
  }

  /**
   * Stores a proposal for the conversation of `ctx` and adds its card to the
   * turn. `undo` is the payload that puts back exactly what this change
   * replaces, for the changes that can be undone (proposeUndo).
   */
  async propose(
    ctx: ToolContext,
    type: string,
    payload: Record<string, unknown>,
    preview: ActionPreview,
    undo?: Record<string, unknown>,
  ): Promise<ActionView> {
    if (ctx.conversationId == null) throw new ConflictException('Las acciones se proponen dentro de una conversación.')
    if (!this.executors.has(type)) throw new Error(`Unknown assistant action ${type}`)
    const row = await this.prisma.assistantAction.create({
      data: {
        type,
        payload: (undo ? { ...payload, undo } : payload) as Prisma.InputJsonObject,
        preview: preview as unknown as Prisma.InputJsonObject,
        expiresAt: new Date(ctx.now.getTime() + PROPOSAL_TTL_MS),
        conversationId: ctx.conversationId,
        producerId: ctx.user.producerId,
        userId: ctx.user.id,
      },
      select: VIEW_SELECT,
    })
    const view = toActionView(row, ctx.now)
    ctx.proposed.push(view)
    return view
  }

  /**
   * Proposes going back on a change this person confirmed, with the exact
   * values it replaced (stored when it was proposed), never the model's memory
   * of them. Going back can itself be undone.
   */
  async proposeUndo(ctx: ToolContext, id: number): Promise<ActionView> {
    const row = await this.prisma.assistantAction.findFirst({
      where: { id, userId: ctx.user.id, producerId: ctx.user.producerId, deletedAt: null },
      select: VIEW_SELECT,
    })
    if (!row) throw new ToolError(`No encontré la propuesta #${id} de esta persona.`)
    if (row.status !== AssistantActionStatus.CONFIRMED) {
      throw new ToolError('Solo se puede deshacer un cambio que se confirmó y se aplicó.')
    }
    const { undo, ...original } = (row.payload ?? {}) as Record<string, unknown>
    if (!undo || typeof undo !== 'object') {
      throw new ToolError('Ese cambio no se puede deshacer desde acá: explicá cómo se revierte en el panel.')
    }
    const preview = row.preview as unknown as ActionPreview
    return this.propose(
      ctx,
      row.type,
      undo as Record<string, unknown>,
      {
        title: `Deshacer: ${preview.title.charAt(0).toLowerCase()}${preview.title.slice(1)}`,
        target: preview.target,
        changes: preview.changes.map(c => ({ label: c.label, before: c.after, after: c.before })),
        notes: ['Vuelve a dejar exactamente lo que había antes de ese cambio.'],
        confirmLabel: 'Deshacer el cambio',
      },
      original,
    )
  }

  async confirm(user: ScopeUser, id: number, now = new Date()): Promise<ConfirmResult> {
    const row = await this.findOwn(user, id)
    const current = toActionView(row, now)
    if (current.status !== 'pending') throw new ConflictException(alreadyMessage(current.status))

    // Claim it first: a double tap or two tabs must not run the change twice.
    const claimed = await this.prisma.assistantAction.updateMany({
      where: { id, status: AssistantActionStatus.PENDING, expiresAt: { gt: now } },
      data: { status: AssistantActionStatus.CONFIRMED, executedAt: now },
    })
    if (!claimed.count) throw new ConflictException(alreadyMessage('confirmed'))

    const executor = this.executors.get(row.type)
    // What goes back on it is kept for proposeUndo, not for the change itself.
    const { undo: _undo, ...payload } = (row.payload ?? {}) as Record<string, unknown>
    try {
      if (!executor) throw new Error(`Unknown assistant action ${row.type}`)
      const codeIds = await this.scope.resolveAccessibleProducerCodeIds(user)
      const outcome = await executor.execute(user, codeIds, payload)
      const updated = await this.prisma.assistantAction.update({
        where: { id },
        data: { result: { summary: outcome.summary, link: outcome.link ?? null } as Prisma.InputJsonObject },
        select: VIEW_SELECT,
      })
      await this.touchConversation(id, now)
      return { action: toActionView(updated, now), refresh: outcome.refresh }
    } catch (error) {
      const message = errorMessage(error)
      this.logger.warn(`La acción ${row.type} #${id} del asistente falló: ${(error as Error).message}`)
      const updated = await this.prisma.assistantAction.update({
        where: { id },
        data: { status: AssistantActionStatus.FAILED, error: message.slice(0, 500) },
        select: VIEW_SELECT,
      })
      return { action: toActionView(updated, now), refresh: [] }
    }
  }

  async cancel(user: ScopeUser, id: number, now = new Date()): Promise<ActionView> {
    const row = await this.findOwn(user, id)
    if (toActionView(row, now).status !== 'pending') return toActionView(row, now)
    const updated = await this.prisma.assistantAction.update({
      where: { id },
      data: { status: AssistantActionStatus.CANCELLED },
      select: VIEW_SELECT,
    })
    return toActionView(updated, now)
  }

  /** The cards of a conversation, by id, as they stand now. */
  async viewsFor(conversationId: number, now = new Date()): Promise<Map<number, ActionView>> {
    const rows = await this.prisma.assistantAction.findMany({
      where: { conversationId, deletedAt: null },
      select: VIEW_SELECT,
    })
    return new Map(rows.map(row => [row.id, toActionView(row, now)]))
  }

  private async findOwn(user: ScopeUser, id: number): Promise<ActionRow> {
    const row = await this.prisma.assistantAction.findFirst({
      where: { id, userId: user.id, producerId: user.producerId, deletedAt: null },
      select: VIEW_SELECT,
    })
    if (!row) throw new NotFoundException('No encontré esa propuesta.')
    return row
  }

  private async touchConversation(actionId: number, now: Date): Promise<void> {
    const action = await this.prisma.assistantAction.findUnique({
      where: { id: actionId },
      select: { conversationId: true },
    })
    if (action) {
      await this.prisma.assistantConversation.update({ where: { id: action.conversationId }, data: { updatedAt: now } })
    }
  }
}

export function toActionView(row: ActionRow, now: Date): ActionView {
  const result = (row.result ?? null) as { summary?: string; link?: ActionLink | null } | null
  const status = statusOf(row, now)
  const payload = (row.payload ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    type: row.type,
    status,
    undoable: status === 'confirmed' && payload.undo != null,
    preview: row.preview as unknown as ActionPreview,
    summary: result?.summary ?? null,
    link: result?.link ?? null,
    error: row.error,
    expiresAt: row.expiresAt.toISOString(),
  }
}

function statusOf(row: Pick<ActionRow, 'status' | 'expiresAt'>, now: Date): ActionStatus {
  switch (row.status) {
    case AssistantActionStatus.PENDING:
      return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending'
    case AssistantActionStatus.CONFIRMED:
      return 'confirmed'
    case AssistantActionStatus.CANCELLED:
      return 'cancelled'
    default:
      return 'failed'
  }
}

function alreadyMessage(status: ActionStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Esta propuesta ya se aplicó.'
    case 'cancelled':
      return 'Esta propuesta se canceló. Pedile al asistente que la arme de nuevo.'
    case 'expired':
      return 'Esta propuesta venció. Pedile al asistente que la arme de nuevo, con los datos actualizados.'
    default:
      return 'Esta propuesta ya no se puede aplicar.'
  }
}

/** What the card says when the change failed: the service's own message for the person, never a stack. */
function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const status = error.getStatus()
    if (status === 404) return 'No encontré ese dato o no tenés acceso a él.'
    if (status === 403) return 'No tenés permiso para hacer este cambio.'
    const response = error.getResponse()
    const message =
      typeof response === 'object' && response && 'message' in response
        ? (response as { message: unknown }).message
        : error.message
    return Array.isArray(message) ? message.join('; ') : String(message)
  }
  return 'No se pudo aplicar el cambio. Probá de nuevo en un rato.'
}
