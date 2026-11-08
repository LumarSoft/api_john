import { Role } from 'generated/prisma/client'
import { ScopeUser } from '../../common/scope/scope.service'
import { PlanFeatureKey } from '../../plan-features/plan-features'

/** One line of an action card: what changes, from what to what. */
export interface ActionChange {
  label: string
  before: string | null
  after: string | null
}

/** What the panel draws for an action before anyone confirms it. */
export interface ActionPreview {
  /** "Cambiar la cuenta para transferencias". */
  title: string
  /** What it applies to: "Toda la organización" or "+54 9 341 … · Sucursal Centro". */
  target: string
  changes: ActionChange[]
  /** Who else it reaches, warnings ("el CBU no pasa el control de dígitos"). */
  notes: string[]
  /** The button: "Cambiar la cuenta". */
  confirmLabel: string
}

export type ActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired'

/** A screen of the panel the card offers after the change ("Ver en Configuración"). */
export interface ActionLink {
  route: string
  label: string
}

/** An action as the panel sees it, from the moment it is proposed. */
export interface ActionView {
  id: number
  type: string
  status: ActionStatus
  /** Confirmed and with the values it replaced: the card offers "Deshacer". */
  undoable: boolean
  preview: ActionPreview
  /** Once confirmed: what was done, in a line. */
  summary: string | null
  link: ActionLink | null
  error: string | null
  expiresAt: string
}

/** What a confirmed action reports back. */
export interface ActionOutcome {
  summary: string
  /**
   * The panel's caches to refresh, as the second part of its query keys
   * (['admin', tag, …]): 'config', 'phone-numbers', 'tasks'…
   */
  refresh: string[]
  link?: ActionLink
}

/** Who runs a tool or an action, and what they see. */
export interface ToolContext {
  user: ScopeUser
  /** The producer codes the user sees (ScopeService.resolveAccessibleProducerCodeIds). */
  codeIds: number[]
  /** The saved conversation it belongs to; null for the old one-shot endpoint, which cannot propose actions. */
  conversationId: number | null
  now: Date
  /** Actions proposed during this turn, for the panel to draw as cards. */
  proposed: ActionView[]
  /**
   * What the person typed in this conversation, their messages only. A new
   * account or contact the bot gives customers has to come from here, never
   * from data a tool read (a client's name, a note, a chat): see saidByPerson.
   */
  ownWords: string
}

export interface AssistantTool {
  name: string
  description: string
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>
  /** What the panel shows while it runs: "Revisando los datos de pago". */
  status: string
  /** Only for these roles. Default: every role that reaches the assistant (OWNER, SUPERADMIN, ADMIN). */
  roles?: Role[]
  /** Only when the organization's plan includes it. */
  feature?: PlanFeatureKey
  /** It proposes an action: only inside a saved conversation. */
  proposes?: boolean
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>
}

/** Carries out a confirmed action with the confirming user's own permissions. */
export interface ActionExecutor {
  type: string
  execute(user: ScopeUser, codeIds: number[], payload: Record<string, unknown>): Promise<ActionOutcome>
  /**
   * Whether what `payload` set is still there, read with the user's own scope.
   * Undo needs it: going back is only safe while nobody changed it since (and
   * it was not undone already). A type without it can't be undone.
   */
  stillApplied?(user: ScopeUser, codeIds: number[], payload: Record<string, unknown>): Promise<boolean>
}

/** A domain's tools and the actions they may propose. */
export interface ToolSet {
  tools: AssistantTool[]
  executors: ActionExecutor[]
}

/** Thrown inside a tool to give the model a message it can act on (missing data, a wrong id). */
export class ToolError extends Error {}
