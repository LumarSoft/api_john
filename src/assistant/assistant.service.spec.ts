import { ConflictException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { allFeatures } from '../plan-features/plan-features'
import type { PlanFeaturesService } from '../plan-features/plan-features.service'
import type { AssistantModelClient, ModelRound, ModelRoundRequest } from './assistant-model.client'
import type { AssistantToolsService } from './assistant-tools.service'
import type { AssistantContextService } from './assistant-context.service'
import type { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantService, AssistantSink } from './assistant.service'
import { OFF_TOPIC_REPLY } from './assistant-prompt'
import type { ActionView, AssistantTool, ToolContext } from './tools/tool.types'

const mili = { id: 2, producerId: 7, role: Role.ADMIN }
const question = { messages: [{ role: 'user' as const, content: '¿Cuál es el estado de la póliza de Juan Pérez?' }] }

/** A round of the model: what it writes and which tools it asks for. */
function round(text: string, calls: Array<{ name: string; args?: object }> = []): ModelRound {
  return {
    text,
    calls: calls.map((c, i) => ({ callId: `call_${i}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) })),
    output: calls.map((c, i) => ({ type: 'function_call', call_id: `call_${i}`, name: c.name })),
  }
}

const card: ActionView = {
  id: 9,
  type: 'datos_de_pago',
  status: 'pending',
  undoable: false,
  preview: {
    title: 'Cambiar la cuenta',
    target: 'Toda la organización',
    changes: [],
    notes: [],
    confirmLabel: 'Cambiar',
  },
  summary: null,
  link: null,
  error: null,
  expiresAt: '2026-11-06T21:00:00.000Z',
}

function setup({ configured = true, rounds = [] as ModelRound[] } = {}) {
  const requests: ModelRoundRequest[] = []
  const model = {
    configured,
    round: jest.fn(async (request: ModelRoundRequest) => {
      requests.push({ ...request, input: [...request.input] })
      const next = rounds.shift() ?? round('')
      if (next.text) request.onText(next.text)
      return next
    }),
  }
  const searchTool: AssistantTool = {
    name: 'buscar_asegurados',
    status: 'Buscando asegurados',
    description: '',
    parameters: {},
    run: jest.fn().mockResolvedValue({ resultados: [{ id: 60, nombre: 'Juan Perez' }] }),
  }
  const proposeTool: AssistantTool = {
    name: 'proponer_cambio_datos_de_pago',
    status: 'Preparando el cambio de cuenta',
    description: '',
    parameters: {},
    proposes: true,
    run: jest.fn(async (ctx: ToolContext) => {
      ctx.proposed.push(card)
      return { propuesta: 9 }
    }),
  }
  const tools = {
    available: jest.fn((_role: Role, _features: unknown, canPropose: boolean) =>
      canPropose ? [searchTool, proposeTool] : [searchTool],
    ),
    statusOf: jest.fn((name: string) => (name === 'buscar_asegurados' ? 'Buscando asegurados' : 'Preparando')),
    run: jest.fn((available: AssistantTool[], ctx: ToolContext, name: string, args: string) =>
      available.find(t => t.name === name)!.run(ctx, JSON.parse(args) as Record<string, unknown>),
    ),
  }
  const context = {
    build: jest.fn().mockResolvedValue({
      orgName: 'Seguros Prueba',
      userName: 'Mili',
      superAdmin: false,
      text: '- Nombre: Mili.\n- Rol: Administrador.',
    }),
  }
  const conversations = {
    findOwn: jest.fn().mockResolvedValue({ id: 4, title: 'x' }),
    create: jest.fn().mockResolvedValue({ id: 4, title: 'Quiero cambiar la cuenta', updatedAt: '2026-11-06' }),
    addQuestion: jest.fn().mockResolvedValue(10),
    historyForModel: jest.fn().mockResolvedValue([{ role: 'user', content: 'Quiero cambiar la cuenta' }]),
    addAnswer: jest.fn(async (_id: number, content: string, blocks: object) => ({ id: 11, content, ...blocks })),
  }
  const planFeatures = {
    forUser: jest.fn().mockResolvedValue({ features: allFeatures(), availableIn: {}, blockedByRole: [] }),
  }
  const service = new AssistantService(
    model as unknown as AssistantModelClient,
    tools as unknown as AssistantToolsService,
    context as unknown as AssistantContextService,
    conversations as unknown as AssistantConversationsService,
    planFeatures as unknown as PlanFeaturesService,
  )
  const sink = { step: jest.fn(), delta: jest.fn(), action: jest.fn() } satisfies AssistantSink
  return { service, model, requests, tools, searchTool, proposeTool, context, conversations, planFeatures, sink }
}

describe('AssistantService.ask (one-shot endpoint)', () => {
  it('looks the client up with the tools, inside the user’s codes, and answers with what they returned', async () => {
    const { service, searchTool, requests } = setup({
      rounds: [
        round('', [{ name: 'buscar_asegurados', args: { texto: 'Juan Pérez' } }]),
        round('La póliza de [Juan Perez](asegurado:60) está **vigente**.'),
      ],
    })

    await expect(service.ask(mili, [3, 4], question)).resolves.toEqual({
      reply: 'La póliza de [Juan Perez](asegurado:60) está **vigente**.',
    })
    expect(searchTool.run).toHaveBeenCalledWith(expect.objectContaining({ user: mili, codeIds: [3, 4] }), {
      texto: 'Juan Pérez',
    })
    // The second round reads the tool's answer.
    expect(requests[1].input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_0',
      output: JSON.stringify({ resultados: [{ id: 60, nombre: 'Juan Perez' }] }),
    })
  })

  it('cannot propose changes: it has no saved conversation to put the card in', async () => {
    const { service, tools } = setup({ rounds: [round('Desde Configuración › Asistente.')] })
    await service.ask(mili, [3], question)
    expect(tools.available).toHaveBeenCalledWith(Role.ADMIN, expect.anything(), false)
  })

  it('needs the key and a plan that includes it', async () => {
    await expect(setup({ configured: false }).service.ask(mili, [3], question)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    const { service, planFeatures } = setup()
    planFeatures.forUser.mockResolvedValueOnce({
      features: { ...allFeatures(), ai_assistant: false },
      availableIn: {},
      blockedByRole: [],
    })
    await expect(service.ask(mili, [3], question)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('stops a person who asks too much in an hour', async () => {
    const { service } = setup({ rounds: Array.from({ length: 61 }, () => round('ok')) })
    const now = new Date('2026-11-06T12:00:00Z')
    for (let i = 0; i < 60; i++) await service.ask(mili, [3], question, now)
    await expect(service.ask(mili, [3], question, now)).rejects.toBeInstanceOf(HttpException)
  })

  it('replaces an answer that came with code anyway', async () => {
    const { service } = setup({ rounds: [round('Claro:\n```js\nconsole.log("Hola mundo")\n```')] })
    await expect(service.ask(mili, [3], question)).resolves.toEqual({ reply: OFF_TOPIC_REPLY })
  })
})

describe('AssistantService conversations', () => {
  it('starts a conversation with the first question and saves it before answering', async () => {
    const { service, conversations } = setup()
    const turn = await service.start(mili, [3], { content: 'Quiero cambiar la cuenta' })
    expect(conversations.create).toHaveBeenCalledWith(mili, 'Quiero cambiar la cuenta')
    expect(conversations.addQuestion).toHaveBeenCalledWith(4, 'Quiero cambiar la cuenta')
    expect(turn.created).toEqual(expect.objectContaining({ id: 4 }))
  })

  it('only continues a conversation of the same person', async () => {
    const { service, conversations } = setup()
    conversations.findOwn.mockRejectedValueOnce(new Error('No encontré esa conversación.'))
    await expect(service.start(mili, [3], { conversationId: 99, content: 'Hola' })).rejects.toThrow()
    expect(conversations.addQuestion).not.toHaveBeenCalled()
  })

  it('streams the steps, the text and the cards, and saves the answer with them', async () => {
    const { service, sink, conversations, context } = setup({
      rounds: [
        round('Dejame revisar la cuenta.', [
          { name: 'proponer_cambio_datos_de_pago', args: { alcance: 'organizacion' } },
        ]),
        round('Te dejé el cambio para que lo confirmes.'),
      ],
    })
    const turn = await service.start(mili, [3], {
      content: 'Quiero cambiar la cuenta',
      page: { route: '/admin/configuracion', screen: 'Configuración' },
    })
    await service.respond(turn, sink)

    expect(context.build).toHaveBeenCalledWith(mili, [3], expect.anything(), [], turn.page, turn.now)
    expect(sink.step).toHaveBeenCalledWith({ id: 'call_0', label: 'Preparando', state: 'running' })
    expect(sink.step).toHaveBeenCalledWith({ id: 'call_0', label: 'Preparando', state: 'done' })
    expect(sink.action).toHaveBeenCalledWith(card)
    expect(sink.delta.mock.calls.map(c => c[0]).join('')).toBe(
      'Dejame revisar la cuenta.\n\nTe dejé el cambio para que lo confirmes.',
    )
    expect(conversations.addAnswer).toHaveBeenCalledWith(
      4,
      'Dejame revisar la cuenta.\n\nTe dejé el cambio para que lo confirmes.',
      { steps: ['Preparando'], actions: [9] },
    )
  })

  it('answers with a pointer to the card when the model only proposed', async () => {
    const { service, sink, conversations } = setup({
      rounds: [round('', [{ name: 'proponer_cambio_datos_de_pago' }]), round('')],
    })
    await service.respond(await service.start(mili, [3], { content: 'Cambiá la cuenta' }), sink)
    expect(conversations.addAnswer.mock.calls[0][1]).toContain('Confirmar')
  })

  it('answers one question at a time per person, and frees them when the answer ends', async () => {
    const { service, sink } = setup({ rounds: [round('Uno.'), round('Dos.')] })
    const first = await service.start(mili, [3], { content: 'Primera' })
    await expect(service.start(mili, [3], { content: 'Segunda' })).rejects.toBeInstanceOf(ConflictException)

    await service.respond(first, sink)
    await expect(service.start(mili, [3], { content: 'Segunda' })).resolves.toBeDefined()
  })

  it('lets only one of two questions sent together through, and a question that fails to start frees the person', async () => {
    const { service, conversations } = setup()
    const results = await Promise.allSettled([
      service.start(mili, [3], { content: 'Una' }),
      service.start(mili, [3], { content: 'Otra' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)

    const other = { ...mili, id: 3 }
    conversations.findOwn.mockRejectedValueOnce(new Error('No encontré esa conversación.'))
    await expect(service.start(other, [3], { conversationId: 99, content: 'Hola' })).rejects.toThrow()
    await expect(service.start(other, [3], { content: 'Hola' })).resolves.toBeDefined()
  })

  it('runs at most 8 tools in one step and leaves at most 5 cards in one answer', async () => {
    const { service, sink, searchTool, proposeTool } = setup({
      rounds: [
        round(
          '',
          Array.from({ length: 10 }, () => ({ name: 'buscar_asegurados' })),
        ),
        round(
          '',
          Array.from({ length: 7 }, () => ({ name: 'proponer_cambio_datos_de_pago' })),
        ),
        round('Listo.'),
      ],
    })
    await service.respond(await service.start(mili, [3], { content: 'Hacé todo' }), sink)
    expect(searchTool.run).toHaveBeenCalledTimes(8)
    expect(proposeTool.run).toHaveBeenCalledTimes(5)
  })

  it('hands the tools what the person typed, and only that, to check new accounts against', async () => {
    const { service, sink, conversations, proposeTool } = setup({
      rounds: [round('', [{ name: 'proponer_cambio_datos_de_pago' }]), round('Listo.')],
    })
    conversations.historyForModel.mockResolvedValueOnce([
      { role: 'user', content: 'El alias nuevo es mi.alias' },
      { role: 'assistant', content: 'Un cliente dijo que el alias es robo.alias' },
      { role: 'user', content: 'Dale' },
    ])
    await service.respond(await service.start(mili, [3], { content: 'Dale' }), sink)
    const ctx = (proposeTool.run as jest.Mock).mock.calls[0][0] as ToolContext
    expect(ctx.ownWords).toBe('El alias nuevo es mi.alias\nDale')
  })

  it('makes the last round answer without tools', async () => {
    const { service, sink, requests } = setup({
      rounds: Array.from({ length: 7 }, (_, i) =>
        i < 6 ? round('', [{ name: 'buscar_asegurados', args: { texto: 'x' } }]) : round('Listo.'),
      ),
    })
    await service.respond(await service.start(mili, [3], { content: 'Buscá' }), sink)
    expect(requests).toHaveLength(7)
    expect(requests[6].allowTools).toBe(false)
  })
})
