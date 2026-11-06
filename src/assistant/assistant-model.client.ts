import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModelTool } from './assistant-tools.service'

const URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-5.6-luna'
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
type Effort = (typeof EFFORTS)[number]
/** One round (thinking, tools asked or the answer), streamed. */
const TIMEOUT_MS = 60_000
const UNAVAILABLE = 'El asistente no pudo responder. Probá de nuevo en un rato.'

/** An item of the Responses API input: a message, or an item a previous round returned or answered. */
export type ModelItem = Record<string, unknown>

export interface ModelCall {
  callId: string
  name: string
  arguments: string
}

export interface ModelRound {
  /** The text this round wrote (already streamed through onText). */
  text: string
  calls: ModelCall[]
  /** Everything the round returned (reasoning, calls, message): goes back as input for the next one. */
  output: ModelItem[]
}

export interface ModelRoundRequest {
  instructions: string
  input: ModelItem[]
  tools: ModelTool[]
  /** False on the last round: the model has to answer with what it has. */
  allowTools: boolean
  onText: (delta: string) => void
  /** The panel closed the stream: stop paying for an answer nobody reads. */
  signal?: AbortSignal
}

/**
 * The OpenAI Responses API, streamed, with reasoning and function tools (the
 * Chat Completions API takes tools on this model only without reasoning).
 * Stateless: store is off and the reasoning comes back encrypted, so each
 * round carries everything it needs. Same account and model as the bot
 * (OPENAI_API_KEY, OPENAI_MODEL); ASSISTANT_REASONING_EFFORT, default low.
 */
@Injectable()
export class AssistantModelClient {
  private readonly logger = new Logger(AssistantModelClient.name)
  private readonly apiKey: string | null
  private readonly model: string
  private readonly effort: Effort

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('OPENAI_API_KEY')?.trim() || null
    this.model = config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_MODEL
    const effort = config.get<string>('ASSISTANT_REASONING_EFFORT')?.trim() as Effort | undefined
    this.effort = effort && EFFORTS.includes(effort) ? effort : 'low'
  }

  get configured(): boolean {
    return this.apiKey != null
  }

  async round(request: ModelRoundRequest): Promise<ModelRound> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools.map(tool => ({ type: 'function', strict: false, ...tool })),
          tool_choice: request.allowTools ? 'auto' : 'none',
          reasoning: { effort: this.effort },
          include: ['reasoning.encrypted_content'],
          store: false,
          stream: true,
          max_output_tokens: 3000,
        }),
        signal,
      })
    } catch (error) {
      this.logger.warn(`El asistente no pudo hablar con OpenAI: ${(error as Error).message}`)
      throw new ServiceUnavailableException(UNAVAILABLE)
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      this.logger.warn(`OpenAI respondió ${response.status} al asistente: ${detail.slice(0, 300)}`)
      throw new ServiceUnavailableException(UNAVAILABLE)
    }

    const round: ModelRound = { text: '', calls: [], output: [] }
    try {
      for await (const event of readEvents(response.body)) this.apply(event, round, request.onText)
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error
      this.logger.warn(`Se cortó la respuesta de OpenAI al asistente: ${(error as Error).message}`)
      throw new ServiceUnavailableException(UNAVAILABLE)
    }
    return round
  }

  private apply(event: StreamEvent, round: ModelRound, onText: (delta: string) => void): void {
    switch (event.type) {
      case 'response.output_text.delta':
        if (typeof event.delta === 'string') {
          round.text += event.delta
          onText(event.delta)
        }
        return
      case 'response.output_item.done': {
        const item = event.item as ModelItem | undefined
        if (!item) return
        round.output.push(item)
        if (item.type === 'function_call') {
          round.calls.push({
            callId: String(item.call_id),
            name: String(item.name),
            arguments: typeof item.arguments === 'string' ? item.arguments : '',
          })
        }
        return
      }
      case 'response.completed': {
        const usage = (event.response as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage
        this.logger.log(
          `Asistente: ${usage?.input_tokens ?? '?'} tokens de entrada, ${usage?.output_tokens ?? '?'} de salida`,
        )
        return
      }
      case 'response.failed':
      case 'response.incomplete':
      case 'error': {
        const detail = JSON.stringify(event.response ?? event).slice(0, 300)
        this.logger.warn(`OpenAI cortó la respuesta del asistente (${event.type}): ${detail}`)
        if (event.type !== 'response.incomplete' || !round.text) throw new ServiceUnavailableException(UNAVAILABLE)
        return
      }
      default:
        return
    }
  }
}

type StreamEvent = { type: string; [key: string]: unknown }

/** Server-sent events off a fetch body: one parsed `data:` payload per event. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = chunk
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
        if (data && data !== '[DONE]') yield JSON.parse(data) as StreamEvent
      }
    }
  } finally {
    reader.releaseLock()
  }
}
