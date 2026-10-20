import { of, throwError } from 'rxjs'
import type { ConfigService } from '@nestjs/config'
import type { HttpService } from '@nestjs/axios'
import type { PrismaService } from '../prisma/prisma.service'
import type { MailService } from '../mail/mail.service'
import { encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { WhatsappConnectionMonitorService, buildDisconnectionCopy } from './whatsapp-connection-monitor.service'

const KEY_HEX = 'a'.repeat(64)

function graphError(code: number, subcode?: number) {
  return { response: { data: { error: { message: 'Meta says no', code, error_subcode: subcode } } } }
}

function waba(overrides: Partial<{ id: number; wabaId: string; disconnectedAt: Date | null }> = {}) {
  return {
    id: 5,
    wabaId: '101875549673776',
    accessToken: encryptSecret('business-token', resolveKey(KEY_HEX, 'K')),
    disconnectedAt: null,
    producer: { name: 'John' },
    phoneNumbers: [{ phoneNumberId: '104026592789442', number: '+54 9 341 242-9786' }],
    ...overrides,
  }
}

function setup(options: { known?: ReturnType<typeof waba>[]; connected?: ReturnType<typeof waba>[]; marked?: number }) {
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { wabaId?: string } }) =>
      Promise.resolve(where.wabaId ? (options.known ?? []) : (options.connected ?? [])),
    )
  const updateMany = jest.fn().mockResolvedValue({ count: options.marked ?? 1 })
  const prisma = { wabaAccount: { findMany, updateMany } }
  const env: Record<string, string> = { WABA_TOKEN_ENCRYPTION_KEY: KEY_HEX, ADVISOR_EMAIL: 'oficina@john.test' }
  const config = { get: jest.fn((name: string) => env[name]) }
  const http = { get: jest.fn() }
  const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) }
  const service = new WhatsappConnectionMonitorService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    http as unknown as HttpService,
    mail as unknown as MailService,
  )
  return { service, prisma, http, mail, env }
}

describe('WhatsappConnectionMonitorService.handleAccountUpdate', () => {
  it('trusts PARTNER_REMOVED on a known WABA: marks it and alerts the office', async () => {
    const { service, prisma, http, mail } = setup({ known: [waba()] })

    await expect(
      service.handleAccountUpdate('101875549673776', {
        event: 'PARTNER_REMOVED',
        reason: 'BUSINESS_DOWNGRADE',
        initiatedBy: 'USER',
      }),
    ).resolves.toEqual({ known: true, checked: 1, disconnected: 1 })

    expect(http.get).not.toHaveBeenCalled()
    expect(prisma.wabaAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 5, disconnectedAt: null },
      data: { disconnectedAt: expect.any(Date), disconnectReason: 'BUSINESS_DOWNGRADE' },
    })
    expect(mail.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['oficina@john.test'],
        subject: expect.stringContaining('+54 9 341 242-9786'),
        text: expect.stringContaining('app común de WhatsApp'),
      }),
    )
  })

  it('checks every connected number when Meta names a WABA we do not store (the 19/10 case)', async () => {
    const { service, prisma, http, mail } = setup({ known: [], connected: [waba()] })
    http.get.mockReturnValue(throwError(() => graphError(100, 33)))

    await expect(
      service.handleAccountUpdate('999', { event: 'PARTNER_REMOVED', reason: 'BUSINESS_DOWNGRADE' }),
    ).resolves.toEqual({ known: false, checked: 1, disconnected: 1 })

    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/104026592789442'),
      expect.objectContaining({ headers: { Authorization: 'Bearer business-token' } }),
    )
    expect(prisma.wabaAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disconnectReason: 'BUSINESS_DOWNGRADE' }) }),
    )
    expect(mail.sendAlert).toHaveBeenCalledTimes(1)
  })

  it('does not mark a number Graph still reports on Cloud API', async () => {
    const { service, prisma, http, mail } = setup({ known: [waba()] })
    http.get.mockReturnValue(of({ data: { platform_type: 'CLOUD_API', status: 'CONNECTED' } }))

    await expect(service.handleAccountUpdate('101875549673776', { event: 'PARTNER_APP_UNINSTALLED' })).resolves.toEqual(
      { known: true, checked: 1, disconnected: 0 },
    )
    expect(prisma.wabaAccount.updateMany).not.toHaveBeenCalled()
    expect(mail.sendAlert).not.toHaveBeenCalled()
  })

  it('alerts only once when the WABA was already marked', async () => {
    const { service, mail } = setup({ known: [waba()], marked: 0 })

    await expect(service.handleAccountUpdate('101875549673776', { event: 'PARTNER_REMOVED' })).resolves.toEqual({
      known: true,
      checked: 1,
      disconnected: 0,
    })
    expect(mail.sendAlert).not.toHaveBeenCalled()
  })

  it('treats a request from an old bot (no event name) as PARTNER_REMOVED', async () => {
    const { service, prisma } = setup({ known: [waba()] })

    await service.handleAccountUpdate('101875549673776', { reason: 'PRIMARY_INACTIVITY' })

    expect(prisma.wabaAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disconnectReason: 'PRIMARY_INACTIVITY' }) }),
    )
  })
})

describe('WhatsappConnectionMonitorService.checkAllConnected', () => {
  it('marks a number that left Cloud API', async () => {
    const { service, prisma, http } = setup({ connected: [waba()] })
    http.get.mockReturnValue(
      of({ data: { display_phone_number: '+54 9 341 242-9786', platform_type: 'NOT_APPLICABLE' } }),
    )

    await expect(service.checkAllConnected()).resolves.toBe(1)
    expect(prisma.wabaAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disconnectReason: 'PLATFORM_NOT_APPLICABLE' }) }),
    )
  })

  it('reads an expired or revoked token as a drop', async () => {
    const { service, prisma, http } = setup({ connected: [waba()] })
    http.get.mockReturnValue(throwError(() => graphError(190)))

    await expect(service.checkAllConnected()).resolves.toBe(1)
    expect(prisma.wabaAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ disconnectReason: 'GRAPH_190' }) }),
    )
  })

  it('leaves the number alone on a timeout or a Meta outage', async () => {
    const { service, prisma, http } = setup({ connected: [waba()] })
    http.get.mockReturnValue(throwError(() => ({ message: 'timeout of 15000ms exceeded' })))

    await expect(service.checkAllConnected()).resolves.toBe(0)
    expect(prisma.wabaAccount.updateMany).not.toHaveBeenCalled()
  })

  it('can be switched off', async () => {
    const { service, http, env } = setup({ connected: [waba()] })
    env.WHATSAPP_CONNECTION_CHECK_ENABLED = 'false'

    await expect(service.checkAllConnected()).resolves.toBe(0)
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('buildDisconnectionCopy', () => {
  it('explains the drop and how to reconnect without breaking Coexistence', () => {
    const { subject, text } = buildDisconnectionCopy({
      producerName: 'John',
      number: '+54 9 341 242-9786',
      reason: 'PRIMARY_INACTIVITY',
      at: new Date('2026-10-19T18:29:28.000Z'),
    })

    expect(subject).toBe('⚠️ WhatsApp desconectado — John (+54 9 341 242-9786)')
    expect(text).toContain('19/10, 15:29')
    expect(text).toContain('14 días')
    expect(text).toContain('Reconectar')
    expect(text).toContain('No uses "Conectar" ni "Añadir número"')
  })
})
