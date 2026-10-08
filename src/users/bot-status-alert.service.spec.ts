import type { ConfigService } from '@nestjs/config'
import type { MailService } from '../mail/mail.service'
import type { PrismaService } from '../prisma/prisma.service'
import { BotStatusAlertService, buildCopy, formatDuration } from './bot-status-alert.service'

describe('BotStatusAlertService', () => {
  const event = {
    producerId: 4,
    producerName: 'John Pellegrini Management Group',
    botEnabled: false,
    actorEmail: 'mili@jpmg.com',
    // 08:12 in Buenos Aires
    at: new Date('2026-10-06T11:12:00Z'),
    since: new Date('2026-10-05T19:00:00Z'),
  }

  function setup(env: Record<string, string>) {
    const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) }
    const prisma = { phoneNumber: { findFirst: jest.fn().mockResolvedValue({ phoneNumberId: 'PN1' }) } }
    const config = { get: jest.fn((key: string) => env[key]) }
    const service = new BotStatusAlertService(
      mail as unknown as MailService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    )
    return { service, mail, prisma }
  }

  it('writes the announcement in the owner’s words', () => {
    const copy = buildCopy(event)
    expect(copy.subject).toBe('⚠️ Bot de WhatsApp desactivado — John Pellegrini Management Group')
    expect(copy.text).toBe(
      'mili@jpmg.com desactivó el bot de WhatsApp de John Pellegrini Management Group el 06/10/2026 a las 08:12. ' +
        'Había estado activo 16 h 12 min. ' +
        'Mientras esté desactivado, los mensajes de los clientes se guardan en la bandeja pero nadie les responde automáticamente.',
    )
    expect(copy.templateParams).toEqual(['mili@jpmg.com', 'desactivó', '06/10/2026 08:12'])

    const back = buildCopy({ ...event, botEnabled: true, at: new Date('2026-10-06T19:00:00Z'), since: event.at })
    expect(back.subject).toContain('reactivado')
    expect(back.text).toContain('volvió a activar')
    expect(back.text).toContain('Estuvo desactivado 7 h 48 min.')
  })

  it('formats durations the way people say them', () => {
    const t0 = new Date('2026-10-06T10:00:00Z')
    expect(formatDuration(t0, new Date('2026-10-06T10:45:00Z'))).toBe('45 min')
    expect(formatDuration(t0, new Date('2026-10-06T13:00:00Z'))).toBe('3 h')
    expect(formatDuration(t0, new Date('2026-10-09T10:00:00Z'))).toBe('3 días')
  })

  it('only logs when no channel is configured', async () => {
    const { service, mail } = setup({})

    await service.notify(event)

    expect(mail.sendAlert).not.toHaveBeenCalled()
  })

  it('emails every configured recipient', async () => {
    const { service, mail } = setup({ BOT_STATUS_ALERT_EMAIL: 'john@jpmg.com, nico@jpmg.com' })

    await service.notify(event)

    expect(mail.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['john@jpmg.com', 'nico@jpmg.com'],
        subject: expect.stringContaining('desactivado'),
      }),
    )
  })

  it('sends the approved template from the organization number when WhatsApp is configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' })
    global.fetch = fetchMock as unknown as typeof fetch
    const { service, prisma } = setup({
      BOT_STATUS_ALERT_PHONE: '5493410000000',
      BOT_STATUS_ALERT_TEMPLATE: 'bot_status_change',
      BOT_URL: 'http://bot:3002',
      BOT_SECRET: 's3',
    })

    await service.notify(event)

    expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { producerId: 4, isActive: true, deletedAt: null } }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://bot:3002/internal/send-template',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-bot-secret': 's3' }),
        body: JSON.stringify({
          to: '5493410000000',
          phoneNumberId: 'PN1',
          template: 'bot_status_change',
          lang: 'es_AR',
          params: ['mili@jpmg.com', 'desactivó', '06/10/2026 08:12'],
        }),
      }),
    )
  })
})
