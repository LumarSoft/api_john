import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ScopeUser } from '../common/scope/scope.service'
import { FEATURE_NOT_FOR_ROLE, FEATURE_NOT_IN_PLAN, PlanFeatures } from '../plan-features/plan-features'
import { PlanFeaturesService } from '../plan-features/plan-features.service'
import { AssistantModelClient, ModelItem } from './assistant-model.client'
import { AssistantToolsService, asModelTools } from './assistant-tools.service'
import { AssistantContextService, PanelPage } from './assistant-context.service'
import { AssistantConversationsService, ConversationSummary, MessageView } from './assistant-conversations.service'
import { cleanLinks, looksLikeCode, OFF_TOPIC_REPLY, systemPrompt } from './assistant-prompt'
import { AskAssistantDto } from './dto/ask-assistant.dto'
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto'
import { ActionView, AssistantTool, ToolContext } from './tools/tool.types'

export { OFF_TOPIC_REPLY, cleanLinks, looksLikeCode }

/** Rounds of tools before the model has to answer with what it has. */
const MAX_ROUNDS = 6
/** Questions per person per hour: a person asking, not a script. */
const MAX_QUESTIONS_PER_HOUR = 60
/** Tools the model may call in one round; the rest get an error back instead of running. */
const MAX_CALLS_PER_ROUND = 8
/** Cards one answer may leave for the person to confirm. */
const MAX_PROPOSALS_PER_TURN = 5
/** One answer at a time per person; a turn that never ended stops counting after this. */
const TURN_LOCK_MS = 3 * 60_000
/** Messages of the old endpoint the model reads. */
const LEGACY_HISTORY = 20
const ACTION_ONLY_REPLY = 'Te dejé la propuesta abajo: revisala y tocá «Confirmar» si está todo bien.'

/** A step the assistant is taking, as the panel shows it live. */
export interface StepEvent {
  id: string
  label: string
  state: 'running' | 'done'
}

/** Where a turn reports what happens while it happens (the SSE stream, or nothing for the old endpoint). */
export interface AssistantSink {
  step(event: StepEvent): void
  delta(text: string): void
  action(view: ActionView): void
}

const SILENT: AssistantSink = { step: () => undefined, delta: () => undefined, action: () => undefined }

/** A question accepted and saved, ready to be answered. */
export interface AssistantTurn {
  user: ScopeUser
  codeIds: number[]
  features: PlanFeatures
  blockedByRole: string[]
  conversationId: number
  /** Set when this question started a new conversation. */
  created: ConversationSummary | null
  page?: PanelPage
  now: Date
}

interface AnswerInput {
  user: ScopeUser
  codeIds: number[]
  features: PlanFeatures
  blockedByRole: string[]
  conversationId: number | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  page?: PanelPage
  now: Date
}

/**
 * The panel's AI assistant. It knows who is asking and from which screen
 * (AssistantContextService), reads the system through tools built on the
 * panel's own services, and prepares changes the person confirms with a tap
 * (AssistantActionsService). The answer streams to the panel as it is written,
 * with the steps it takes, and the conversation is saved for the person.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name)
  /** userId → when they asked, within the last hour. */
  private readonly asked = new Map<number, number[]>()
  /** userId → when the answer being written for them started. */
  private readonly answering = new Map<number, number>()

  constructor(
    private readonly model: AssistantModelClient,
    private readonly tools: AssistantToolsService,
    private readonly context: AssistantContextService,
    private readonly conversations: AssistantConversationsService,
    private readonly planFeatures: PlanFeaturesService,
  ) {}

  /** The old one-shot endpoint: the panel sends the conversation, nothing is saved and no change is proposed. */
  async ask(user: ScopeUser, codeIds: number[], dto: AskAssistantDto, now = new Date()): Promise<{ reply: string }> {
    const plans = await this.admit(user, now)
    const answer = await this.answer(
      {
        user,
        codeIds,
        features: plans.features,
        blockedByRole: plans.blockedByRole,
        conversationId: null,
        history: dto.messages.slice(-LEGACY_HISTORY).map(m => ({ role: m.role, content: m.content })),
        now,
      },
      SILENT,
    )
    return { reply: answer.reply }
  }

  /** Checks the person may ask and saves the question. Throws before any stream starts. */
  async start(
    user: ScopeUser,
    codeIds: number[],
    dto: SendAssistantMessageDto,
    now = new Date(),
  ): Promise<AssistantTurn> {
    // Taken before anything is awaited, so two questions sent together can't both get past it.
    const since = this.answering.get(user.id)
    if (since != null && now.getTime() - since < TURN_LOCK_MS) {
      throw new ConflictException('Todavía estoy respondiendo tu pregunta anterior: esperá a que termine.')
    }
    this.answering.set(user.id, now.getTime())
    try {
      const plans = await this.admit(user, now)
      let created: ConversationSummary | null = null
      let conversationId = dto.conversationId
      if (conversationId) {
        await this.conversations.findOwn(user, conversationId)
      } else {
        created = await this.conversations.create(user, dto.content)
        conversationId = created.id
      }
      await this.conversations.addQuestion(conversationId, dto.content)
      return {
        user,
        codeIds,
        features: plans.features,
        blockedByRole: plans.blockedByRole,
        conversationId,
        created,
        page: dto.page,
        now,
      }
    } catch (error) {
      this.answering.delete(user.id)
      throw error
    }
  }

  /** Answers a saved question, streaming through `sink`, and saves the answer. */
  async respond(turn: AssistantTurn, sink: AssistantSink, signal?: AbortSignal): Promise<MessageView> {
    try {
      const history = await this.conversations.historyForModel(turn.conversationId, turn.now)
      const answer = await this.answer({ ...turn, history }, sink, signal)
      return await this.conversations.addAnswer(turn.conversationId, answer.reply, {
        steps: answer.steps,
        actions: answer.actionIds,
      })
    } finally {
      this.answering.delete(turn.user.id)
    }
  }

  /**
   * The person's plan functions, or 403 when their plan or their role leaves
   * the assistant out. Confirming a proposal checks it again: the owner may
   * have taken the assistant off the plan or the role after it was proposed.
   */
  async assertEnabled(user: ScopeUser) {
    const plans = await this.planFeatures.forUser(user)
    if (plans.blockedByRole.includes('ai_assistant')) throw new ForbiddenException(FEATURE_NOT_FOR_ROLE)
    if (!plans.features.ai_assistant) throw new ForbiddenException(FEATURE_NOT_IN_PLAN.ai_assistant)
    return plans
  }

  private async admit(user: ScopeUser, now: Date) {
    if (!this.model.configured) throw new ServiceUnavailableException('El asistente todavía no está configurado.')
    const plans = await this.assertEnabled(user)
    this.countQuestion(user.id, now)
    return plans
  }

  private async answer(
    input: AnswerInput,
    sink: AssistantSink,
    signal?: AbortSignal,
  ): Promise<{ reply: string; steps: string[]; actionIds: number[] }> {
    const { user, codeIds, conversationId, now } = input
    const context = await this.context.build(user, codeIds, input.features, input.blockedByRole, input.page, now)
    const canPropose = conversationId != null
    const available = this.tools.available(user.role, input.features, canPropose)
    const tools = asModelTools(available)
    const instructions = systemPrompt({
      orgName: context.orgName,
      context: context.text,
      canPropose,
      superAdmin: context.superAdmin,
    })
    const items: ModelItem[] = input.history.map(m => ({ role: m.role, content: m.content }))
    const ownWords = input.history
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n')
    const toolCtx: ToolContext = { user, codeIds, conversationId, now, proposed: [], ownWords }
    const steps: string[] = []
    const actionIds: number[] = []
    let text = ''

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS
      let started = false
      const result = await this.model.round({
        instructions,
        input: items,
        tools,
        allowTools: !lastRound,
        signal,
        onText: delta => {
          // What a round wrote before calling tools stays; the next round's text starts a new paragraph.
          if (!started && text.trim()) {
            text += '\n\n'
            sink.delta('\n\n')
          }
          started = true
          text += delta
          sink.delta(delta)
        },
      })
      if (!result.calls.length || lastRound) break

      items.push(...result.output)
      for (const [index, call] of result.calls.entries()) {
        const refusal = this.refusal(available, call.name, index, actionIds.length)
        if (refusal) {
          items.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify({ error: refusal }) })
          continue
        }
        const label = this.tools.statusOf(call.name)
        sink.step({ id: call.callId, label, state: 'running' })
        const output = await this.tools.run(available, toolCtx, call.name, call.arguments)
        sink.step({ id: call.callId, label, state: 'done' })
        if (!steps.includes(label)) steps.push(label)
        for (const view of toolCtx.proposed.splice(0)) {
          actionIds.push(view.id)
          sink.action(view)
        }
        items.push({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(output ?? null) })
      }
    }

    let reply = cleanLinks(text.trim())
    if (looksLikeCode(reply)) {
      this.logger.warn(`El asistente respondió con código a ${user.id}; se reemplazó por el aviso de fuera de tema`)
      reply = OFF_TOPIC_REPLY
    }
    if (!reply) {
      if (!actionIds.length)
        throw new ServiceUnavailableException('El asistente no pudo responder. Probá de nuevo en un rato.')
      reply = ACTION_ONLY_REPLY
    }
    return { reply, steps, actionIds }
  }

  /** Why a call doesn't run, when it goes past what one answer may do. */
  private refusal(available: AssistantTool[], name: string, index: number, proposed: number): string | null {
    if (index >= MAX_CALLS_PER_ROUND) {
      return 'Demasiadas herramientas en un mismo paso: respondé con lo que ya tenés o seguí de a poco.'
    }
    if (proposed >= MAX_PROPOSALS_PER_TURN && available.find(tool => tool.name === name)?.proposes) {
      return `Ya hay ${proposed} propuestas en esta respuesta: pedile a la persona que las revise antes de preparar más.`
    }
    return null
  }

  private countQuestion(userId: number, now: Date) {
    const since = now.getTime() - 3_600_000
    const recent = (this.asked.get(userId) ?? []).filter(t => t > since)
    if (recent.length >= MAX_QUESTIONS_PER_HOUR) {
      throw new HttpException('Hiciste muchas preguntas seguidas. Esperá unos minutos.', HttpStatus.TOO_MANY_REQUESTS)
    }
    recent.push(now.getTime())
    this.asked.set(userId, recent)
  }
}
