import { BadGatewayException, InternalServerErrorException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { BotNotifierService } from './bot-notifier.service'

describe('BotNotifierService.sendMessage', () => {
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService
  const service = new BotNotifierService(config)

  afterEach(() => jest.restoreAllMocks())

  function botAnswers(status: number, body: unknown) {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  }

  it('passes the reason the bot gives for a rejected send on to the panel', async () => {
    botAnswers(502, { statusCode: 502, message: 'El número de WhatsApp está desconectado de Meta.' })

    const sending = service.sendMessage('549341', 'Hola', 'P1')
    await expect(sending).rejects.toBeInstanceOf(BadGatewayException)
    await expect(sending).rejects.toThrow('desconectado de Meta')
  })

  it('stays generic when the bot itself failed', async () => {
    botAnswers(500, 'Internal server error')

    await expect(service.sendMessage('549341', 'Hola', 'P1')).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
