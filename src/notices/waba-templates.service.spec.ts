import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { NOTICE_TEMPLATES } from './notice-templates'
import { WabaTemplatesService } from './waba-templates.service'

jest.mock('../common/crypto/secret-crypto', () => ({
  decryptSecret: (value: string) => `plain-${value}`,
  resolveKey: () => Buffer.alloc(32),
}))

const notice = NOTICE_TEMPLATES.payment_rejection
const [first, current] = notice.versions

function setup(answers: Record<string, unknown>) {
  const prisma = {
    wabaAccount: {
      findMany: jest.fn().mockResolvedValue([
        { id: 6, wabaId: 'office-waba', accessToken: 'a' },
        { id: 8, wabaId: 'branch-waba', accessToken: 'b' },
      ]),
    },
  }
  const config = { get: jest.fn().mockReturnValue(undefined) }
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(((url: URL) => {
    const waba = new URL(String(url)).pathname.split('/')[2]
    const answer = answers[waba]
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve({
      ok: !(answer as { error?: unknown }).error,
      json: () => Promise.resolve(answer),
    })
  }) as unknown as typeof fetch)
  const service = new WabaTemplatesService(prisma as unknown as PrismaService, config as unknown as ConfigService)
  return { service, fetchMock }
}

afterEach(() => jest.restoreAllMocks())

describe('WabaTemplatesService.approvedVersionsIn', () => {
  it('gives each account the newest version Meta approved there, or null when it has none', async () => {
    const { service } = setup({
      // The first organization's account: the first text approved, the new one in review.
      'office-waba': {
        data: [
          { name: 'aviso_rechazo_pago', language: 'es_AR', status: 'APPROVED' },
          { name: 'aviso_rechazo_pago_v2', language: 'es_AR', status: 'PENDING' },
        ],
      },
      // Only the campaigns were created in the branch's account.
      'branch-waba': { data: [] },
    })

    await expect(service.approvedVersionsIn([6, 8], notice)).resolves.toEqual(
      new Map([
        [6, first],
        [8, null],
      ]),
    )
  })

  it('prefers the new text once it is approved', async () => {
    const { service } = setup({
      'office-waba': {
        data: [
          { name: 'aviso_rechazo_pago', language: 'es_AR', status: 'APPROVED' },
          { name: 'aviso_rechazo_pago_v2', language: 'es_AR', status: 'APPROVED' },
        ],
      },
      'branch-waba': { data: [{ name: 'aviso_rechazo_pago_v2', language: 'es_AR', status: 'APPROVED' }] },
    })

    const versions = await service.approvedVersionsIn([6, 8], notice)
    expect(versions.get(6)).toBe(current)
    expect(versions.get(8)).toBe(current)
  })

  it('counts a template in review, in another language or paused as not approved', async () => {
    const { service } = setup({
      'office-waba': { data: [{ name: 'aviso_rechazo_pago_v2', language: 'es', status: 'APPROVED' }] },
      'branch-waba': { data: [{ name: 'aviso_rechazo_pago_v2', language: 'es_AR', status: 'PAUSED' }] },
    })

    await expect(service.approvedVersionsIn([6, 8], notice)).resolves.toEqual(
      new Map([
        [6, null],
        [8, null],
      ]),
    )
  })

  it('leaves out an account Meta did not answer for, so the send says what went wrong', async () => {
    const { service } = setup({
      'office-waba': { error: { message: 'Error validating access token' } },
      'branch-waba': new Error('timeout'),
    })

    await expect(service.approvedVersionsIn([6, 8], notice)).resolves.toEqual(new Map())
  })

  it('asks Meta again only after a few minutes', async () => {
    const { service, fetchMock } = setup({ 'office-waba': { data: [] }, 'branch-waba': { data: [] } })
    const start = Date.parse('2026-11-05T12:00:00Z')

    await service.approvedVersionsIn([6, 8], notice, start)
    await service.approvedVersionsIn([6, 8], notice, start + 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await service.approvedVersionsIn([6, 8], notice, start + 6 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('WabaTemplatesService.createTemplate', () => {
  const account = { id: 6, wabaId: 'office-waba', accessToken: 'a' }
  const template = {
    name: 'aviso_rechazo_pago_v2',
    lang: 'es_AR',
    category: 'UTILITY' as const,
    body: 'Hola {{1}}, te escribimos de {{2}}.',
    example: ['Juan', 'Seguros del Litoral'],
  }

  it('sends the body with its examples to the account', async () => {
    const { service, fetchMock } = setup({ 'office-waba': { id: '123', status: 'PENDING' } })

    await expect(service.createTemplate(account, template)).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/office-waba/message_templates')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'aviso_rechazo_pago_v2',
      language: 'es_AR',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: template.body, example: { body_text: [['Juan', 'Seguros del Litoral']] } }],
    })
  })

  it('takes a template Meta already has as created, and says why Meta refused one', async () => {
    const exists = setup({ 'office-waba': { error: { message: 'x', error_subcode: 2388023 } } })
    await expect(exists.service.createTemplate(account, template)).resolves.toEqual({ ok: true })
    jest.restoreAllMocks()

    const refused = setup({
      'office-waba': { error: { message: 'Invalid parameter', error_user_msg: 'Formato inválido' } },
    })
    await expect(refused.service.createTemplate(account, template)).resolves.toEqual({
      ok: false,
      reason: 'Formato inválido',
    })
  })
})
