import { ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import { of } from 'rxjs'
import type { PrismaService } from '../prisma/prisma.service'
import type { PlanFeaturesService } from '../plan-features/plan-features.service'
import { allFeatures } from '../plan-features/plan-features'
import type { ProposalsService } from '../improvements/proposals.service'
import type { AssistantDataService } from './assistant-data.service'
import { AssistantService, OFF_TOPIC_REPLY, cleanLinks, looksLikeCode } from './assistant.service'

const mili = { id: 2, producerId: 7, role: Role.ADMIN }
const question = { messages: [{ role: 'user' as const, content: '¿Cuál es el estado de la póliza de Juan Pérez?' }] }

function completion(message: Record<string, unknown>) {
  return of({
    data: { choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  })
}

function setup({ key = 'sk-prueba' as string | null } = {}) {
  const http = { post: jest.fn() }
  const prisma = { producer: { findUnique: jest.fn().mockResolvedValue({ name: 'Seguros Prueba', botProfile: null }) } }
  const data = {
    searchClients: jest.fn().mockResolvedValue({ resultados: [{ id: 60, nombre: 'Juan Perez' }] }),
    clientFile: jest.fn().mockResolvedValue({ id: 60, nombre: 'Juan Perez', polizas: [{ estado: 'vigente' }] }),
    expiringPolicies: jest.fn(),
    unpaidInstallments: jest.fn(),
    portfolioSummary: jest.fn(),
  }
  const planFeatures = {
    forUser: jest.fn().mockResolvedValue({ features: allFeatures(), availableIn: {}, blockedByRole: [] }),
  }
  const proposals = { create: jest.fn().mockResolvedValue({ id: 31 }) }
  const config = { get: jest.fn((name: string) => (name === 'OPENAI_API_KEY' ? key : undefined)) }
  const service = new AssistantService(
    http as unknown as HttpService,
    prisma as unknown as PrismaService,
    data as unknown as AssistantDataService,
    planFeatures as unknown as PlanFeaturesService,
    proposals as unknown as ProposalsService,
    config as unknown as ConfigService,
  )
  return { service, http, data, planFeatures, proposals }
}

describe('AssistantService.ask', () => {
  it('looks the client up with the tools, inside the user’s codes, and answers with what they returned', async () => {
    const { service, http, data } = setup()
    http.post
      .mockReturnValueOnce(
        completion({
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'buscar_asegurados', arguments: '{"texto":"Juan Pérez"}' },
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        completion({
          content: null,
          tool_calls: [{ id: 'c2', type: 'function', function: { name: 'ver_asegurado', arguments: '{"id":60}' } }],
        }),
      )
      .mockReturnValueOnce(completion({ content: 'La póliza de [Juan Perez](asegurado:60) está **vigente**.' }))

    await expect(service.ask(mili, [3, 4], question)).resolves.toEqual({
      reply: 'La póliza de [Juan Perez](asegurado:60) está **vigente**.',
    })
    expect(data.searchClients).toHaveBeenCalledWith(7, [3, 4], 'Juan Pérez')
    expect(data.clientFile).toHaveBeenCalledWith(7, [3, 4], 60)
    // The model gets the tool results back, tied to its calls, and the office's name in the instructions.
    const last = http.post.mock.calls[2][1] as {
      messages: Array<{ role: string; content: string; tool_call_id?: string }>
    }
    expect(last.messages[0].content).toContain('Seguros Prueba')
    expect(last.messages.at(-1)).toEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'c2' }))
  })

  it('turns a bad tool call into an error the model can read instead of failing', async () => {
    const { service, http } = setup()
    http.post
      .mockReturnValueOnce(
        completion({
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'borrar_todo', arguments: '{' } }],
        }),
      )
      .mockReturnValueOnce(completion({ content: 'No puedo hacer eso.' }))

    await expect(service.ask(mili, [3], question)).resolves.toEqual({ reply: 'No puedo hacer eso.' })
    const second = http.post.mock.calls[1][1] as { messages: Array<{ role: string; content: string }> }
    expect(second.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'tool', content: '{"error":"Argumentos inválidos."}' }),
    )
  })

  it('needs the key and a plan that includes it', async () => {
    await expect(setup({ key: null }).service.ask(mili, [3], question)).rejects.toThrow(ServiceUnavailableException)

    const { service, planFeatures, http } = setup()
    planFeatures.forUser.mockResolvedValue({
      features: { ...allFeatures(), ai_assistant: false },
      availableIn: {},
      blockedByRole: [],
    })
    await expect(service.ask(mili, [3], question)).rejects.toThrow(ForbiddenException)
    expect(http.post).not.toHaveBeenCalled()
  })

  it('stops a person who asks too much in an hour', async () => {
    const { service, http } = setup()
    http.post.mockImplementation(() => completion({ content: 'Listo.' }))
    const now = new Date('2026-11-04T15:00:00Z')
    for (let i = 0; i < 60; i++) await service.ask(mili, [3], question, now)

    await expect(service.ask(mili, [3], question, now)).rejects.toThrow(HttpException)
    await expect(service.ask(mili, [3], question, new Date('2026-11-04T16:01:00Z'))).resolves.toEqual({
      reply: 'Listo.',
    })
  })
})

describe('AssistantService panel help and proposals', () => {
  const call = (id: string, name: string, args: unknown) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  })

  it('reads the panel guide when asked how to do something', async () => {
    const { service, http } = setup()
    http.post
      .mockReturnValueOnce(completion({ content: null, tool_calls: [call('g1', 'como_usar_el_panel', {})] }))
      .mockReturnValueOnce(completion({ content: 'Entrá a Rechazos y tocá Cargar Excel.' }))

    await expect(service.ask(mili, [3], question)).resolves.toEqual({ reply: 'Entrá a Rechazos y tocá Cargar Excel.' })
    const second = http.post.mock.calls[1][1] as { messages: Array<{ role: string; content: string }> }
    expect(second.messages.at(-1)?.content).toContain('Rechazos')
  })

  it('sends a proposal only once the person confirmed it, signed by them', async () => {
    const { service, http, proposals } = setup()
    const draft = {
      titulo: 'Filtro por cobertura en Asegurados',
      descripcion: 'Hoy no se puede filtrar por cobertura; propongo un filtro.',
    }
    http.post
      .mockReturnValueOnce(
        completion({
          content: null,
          tool_calls: [call('p1', 'enviar_propuesta_de_mejora', { ...draft, confirmado: false })],
        }),
      )
      .mockReturnValueOnce(completion({ content: '¿La envío?' }))
      .mockReturnValueOnce(
        completion({
          content: null,
          tool_calls: [call('p2', 'enviar_propuesta_de_mejora', { ...draft, confirmado: true })],
        }),
      )
      .mockReturnValueOnce(completion({ content: 'Listo, la envié a Mejoras › Propuestas.' }))

    await service.ask(mili, [3], question)
    expect(proposals.create).not.toHaveBeenCalled()

    await expect(service.ask(mili, [3], question)).resolves.toEqual({
      reply: 'Listo, la envié a Mejoras › Propuestas.',
    })
    expect(proposals.create).toHaveBeenCalledWith(7, 2, {
      title: 'Filtro por cobertura en Asegurados',
      description: 'Hoy no se puede filtrar por cobertura; propongo un filtro.',
    })
  })
})

describe('AssistantService off-topic requests', () => {
  const helloWorld = { messages: [{ role: 'user' as const, content: 'Escribime un hola mundo en JavaScript' }] }

  it('tells the model to answer only about the office’s work, with the fixed reply for the rest', async () => {
    const { service, http } = setup()
    http.post.mockReturnValueOnce(completion({ content: OFF_TOPIC_REPLY }))

    await expect(service.ask(mili, [3], helloWorld)).resolves.toEqual({ reply: OFF_TOPIC_REPLY })
    const instructions = (http.post.mock.calls[0][1] as { messages: Array<{ content: string }> }).messages[0].content
    expect(instructions).toContain('Solo respondés sobre esas cuatro cosas')
    expect(instructions).toContain('hola mundo')
    expect(instructions).toContain(OFF_TOPIC_REPLY)
  })

  it('replaces an answer that came with code anyway', async () => {
    const { service, http } = setup()
    http.post.mockReturnValueOnce(completion({ content: 'Claro:\n```js\nconsole.log("Hola mundo")\n```' }))

    await expect(service.ask(mili, [3], helloWorld)).resolves.toEqual({ reply: OFF_TOPIC_REPLY })
  })
})

describe('looksLikeCode', () => {
  it('spots code in any common shape', () => {
    for (const reply of [
      '```\nalgo\n```',
      'Usá console.log("Hola mundo")',
      'print("Hola mundo")',
      'def saludar():\n    return 1',
      'function saludar() { return 1 }',
      'const saludo = "hola"',
      '<script>alert(1)</script>',
      'public static void main(String[] args)',
      'import React from "react"',
      '<?php echo "hola"; ?>',
    ]) {
      expect(looksLikeCode(reply)).toBe(true)
    }
  })

  it('leaves the office’s answers alone', () => {
    for (const reply of [
      'La póliza de [Juan Perez](asegurado:60) está **vigente** y vence el 12/12/2026.',
      '- **3 cuotas vencidas**: $ 45.300 en total\n- 1 rechazada por el débito',
      'Entrá a Rechazos › Cargar Excel y elegí el archivo de Triunfo.',
      'La franquicia es el monto que paga el asegurado en cada siniestro (por ejemplo $ 150.000).',
      'Constante: la cuota sube un 8 % => $ 21.600 por mes.',
      OFF_TOPIC_REPLY,
    ]) {
      expect(looksLikeCode(reply)).toBe(false)
    }
  })
})

describe('cleanLinks', () => {
  it('keeps the links with a client id and turns the rest into plain names', () => {
    expect(cleanLinks('[Juan Perez](asegurado:60) y [Ana](asegurado:?) y [Luis](asegurado:)')).toBe(
      '[Juan Perez](asegurado:60) y Ana y Luis',
    )
  })
})
