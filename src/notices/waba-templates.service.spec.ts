import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { WabaTemplatesService } from './waba-templates.service'

jest.mock('../common/crypto/secret-crypto', () => ({
  decryptSecret: (value: string) => `plain-${value}`,
  resolveKey: () => Buffer.alloc(32),
}))

const notice = { name: 'aviso_rechazo_pago', lang: 'es_AR' }

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

describe('WabaTemplatesService.notApprovedIn', () => {
  it('lists the accounts where Meta has no approved template in that language', async () => {
    const { service } = setup({
      'office-waba': { data: [{ name: 'aviso_rechazo_pago', language: 'es_AR', status: 'APPROVED' }] },
      // Only the campaigns were created in the branch's account.
      'branch-waba': { data: [] },
    })

    await expect(service.notApprovedIn([6, 8], notice)).resolves.toEqual(new Set([8]))
  })

  it('counts a template in review, in another language or paused as not approved', async () => {
    const { service } = setup({
      'office-waba': { data: [{ name: 'aviso_rechazo_pago', language: 'es', status: 'APPROVED' }] },
      'branch-waba': { data: [{ name: 'aviso_rechazo_pago', language: 'es_AR', status: 'PAUSED' }] },
    })

    await expect(service.notApprovedIn([6, 8], notice)).resolves.toEqual(new Set([6, 8]))
  })

  it('leaves out an account Meta did not answer for, so the send says what went wrong', async () => {
    const { service } = setup({
      'office-waba': { error: { message: 'Error validating access token' } },
      'branch-waba': new Error('timeout'),
    })

    await expect(service.notApprovedIn([6, 8], notice)).resolves.toEqual(new Set())
  })

  it('asks Meta again only after a few minutes', async () => {
    const { service, fetchMock } = setup({ 'office-waba': { data: [] }, 'branch-waba': { data: [] } })
    const start = Date.parse('2026-11-05T12:00:00Z')

    await service.notApprovedIn([6, 8], notice, start)
    await service.notApprovedIn([6, 8], notice, start + 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await service.notApprovedIn([6, 8], notice, start + 6 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
