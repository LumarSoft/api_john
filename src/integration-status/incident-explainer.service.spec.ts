import { of } from 'rxjs'
import { BadGatewayException } from '@nestjs/common'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'
import { IncidentExplainerService, type IncidentContext } from './incident-explainer.service'

const CONTEXT: IncidentContext = {
  provider: 'Triunfo Seguros',
  service: 'RESTDocumentosV2, la documentación de pólizas',
  purpose: 'lista los documentos de una póliza',
  failure: {
    kind: 'HTTP_ERROR',
    httpStatus: 404,
    message: 'HTTP 404 Not Found',
    answer: 'La página que intenta visitar no existe o ha sido movida.',
    startedAt: new Date('2026-11-03T03:32:28Z'),
    failures: 16,
    lastSuccessAt: new Date('2026-11-02T22:10:41Z'),
  },
  otherServices: [
    {
      service: 'RESTCotizadorAutV2, el cotizador de autos y motos',
      state: 'funciona',
      lastSuccessAt: new Date('2026-11-03T16:39:12Z'),
      failure: null,
    },
  ],
}

const ANSWER = {
  explanation: 'Triunfo movió el servicio de documentación; el resto de Triunfo anda.',
  blame: 'PROVIDER',
  blameReason: 'Triunfo: movió esta dirección sin avisar',
}

function setup(env: Record<string, string>, content = JSON.stringify(ANSWER), finishReason = 'stop') {
  const http = {
    post: jest
      .fn()
      .mockReturnValue(
        of({ data: { choices: [{ finish_reason: finishReason, message: { content } }], usage: { prompt_tokens: 1 } } }),
      ),
  }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  return { http, service: new IncidentExplainerService(http as unknown as HttpService, config) }
}

describe('IncidentExplainerService', () => {
  it('is off without an OpenAI key', () => {
    expect(setup({}).service.enabled).toBe(false)
  })

  it("asks the bot's model for a strict answer, with the failure and the provider's other services", async () => {
    const { service, http } = setup({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test' })

    await expect(service.explain(CONTEXT)).resolves.toEqual(ANSWER)

    const [url, body, options] = http.post.mock.calls[0] as [string, Record<string, unknown>, { headers: object }]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(body).toMatchObject({
      model: 'gpt-test',
      response_format: { type: 'json_schema', json_schema: { name: 'incident_explanation', strict: true } },
    })
    const user = JSON.parse((body.messages as Array<{ content: string }>)[1].content) as Record<string, unknown>
    expect(user).toMatchObject({
      proveedor: 'Triunfo Seguros',
      falla: { estadoHttp: 404, respuestaDelProveedor: CONTEXT.failure.answer, intentosFallidos: 16 },
      otrosServiciosDelMismoProveedor: [{ estado: 'funciona' }],
    })
    expect(options.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('refuses an answer cut short', async () => {
    const { service } = setup({ OPENAI_API_KEY: 'sk-test' }, '{"explanation":', 'length')
    await expect(service.explain(CONTEXT)).rejects.toBeInstanceOf(BadGatewayException)
  })
})
