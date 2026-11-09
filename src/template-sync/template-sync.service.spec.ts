import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { WabaTemplatesService } from '../notices/waba-templates.service'
import type { SalesCampaignsService } from '../sales-campaigns/sales-campaigns.service'
import { TemplateSyncService } from './template-sync.service'

const meta = (name: string, status = 'APPROVED', language = 'es_AR') => ({
  name,
  language,
  category: 'UTILITY',
  status,
  rejectedReason: null,
  quality: null,
})

function setup(options: { env?: Record<string, string>; templatesOf?: jest.Mock } = {}) {
  const env: Record<string, string> = {
    META_TEMPLATE_SYNC_ENABLED: 'true',
    POLICY_EXPIRY_TEMPLATE: 'aviso_poliza_vencida',
    PAYMENT_REJECTION_TEMPLATE: 'aviso_rechazo_pago',
    ...options.env,
  }
  const prisma = {
    wabaAccount: {
      findMany: jest.fn().mockResolvedValue([
        // The first organization's office, with both notices of the first texts.
        { id: 6, wabaId: 'office-waba', accessToken: 'a', producerId: 1 },
        // A branch connected later: nothing yet.
        { id: 9, wabaId: 'branch-waba', accessToken: 'b', producerId: 1 },
      ]),
    },
  }
  const config = { get: jest.fn((key: string) => env[key]) }
  const templates = {
    templatesOf:
      options.templatesOf ??
      jest.fn((account: { id: number }) =>
        Promise.resolve(account.id === 6 ? [meta('aviso_poliza_vencida'), meta('aviso_rechazo_pago')] : []),
      ),
    createTemplate: jest.fn().mockResolvedValue({ ok: true }),
  }
  const campaigns = { syncNewAccounts: jest.fn().mockResolvedValue(2) }
  const service = new TemplateSyncService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    templates as unknown as WabaTemplatesService,
    campaigns as unknown as SalesCampaignsService,
  )
  return { service, prisma, templates, campaigns }
}

describe('TemplateSyncService.sync', () => {
  it("creates each notice's newest text where the account does not have it, and the campaigns' texts", async () => {
    const { service, templates, campaigns } = setup()

    await expect(service.sync()).resolves.toEqual({ notices: 3, campaigns: 2 })

    const created = templates.createTemplate.mock.calls.map(([account, t]) => [account.id, t.name])
    expect(created).toEqual([
      [6, 'aviso_rechazo_pago_v2'],
      [9, 'aviso_poliza_vencida'],
      [9, 'aviso_rechazo_pago_v2'],
    ])
    expect(templates.createTemplate.mock.calls[1][1]).toEqual({
      name: 'aviso_poliza_vencida',
      lang: 'es_AR',
      category: 'UTILITY',
      body: expect.stringContaining('te escribimos de {{2}}'),
      example: ['Juan', 'Seguros del Litoral', '1234567', 'AB123CD', '15/10/2026'],
    })
    expect(campaigns.syncNewAccounts).toHaveBeenCalledWith(undefined)
  })

  it('leaves alone a text Meta has in any state, and one in another language counts as missing', async () => {
    const { service, templates } = setup({
      templatesOf: jest.fn((account: { id: number }) =>
        Promise.resolve(
          account.id === 6
            ? [meta('aviso_poliza_vencida', 'REJECTED'), meta('aviso_rechazo_pago_v2', 'PENDING')]
            : [meta('aviso_poliza_vencida', 'APPROVED', 'es'), meta('aviso_rechazo_pago_v2', 'PAUSED')],
        ),
      ),
    })

    await service.sync()

    expect(templates.createTemplate.mock.calls.map(([account, t]) => [account.id, t.name])).toEqual([
      [9, 'aviso_poliza_vencida'],
    ])
  })

  it('creates only the notices that are on', async () => {
    const { service, templates } = setup({ env: { PAYMENT_REJECTION_TEMPLATE: '' } })

    await service.sync()

    expect(templates.createTemplate.mock.calls.map(([account, t]) => [account.id, t.name])).toEqual([
      [9, 'aviso_poliza_vencida'],
    ])
  })

  it('goes on with the next account when Meta does not answer for one', async () => {
    const { service, templates } = setup({
      templatesOf: jest.fn((account: { id: number }) =>
        account.id === 6 ? Promise.reject(new Error('Error validating access token')) : Promise.resolve([]),
      ),
    })

    await expect(service.sync()).resolves.toEqual(expect.objectContaining({ notices: 2 }))
    expect(templates.createTemplate.mock.calls.every(([account]) => account.id === 9)).toBe(true)
  })

  it("after a connection, looks only at that account and its organization's campaigns", async () => {
    const { service, prisma, campaigns } = setup()
    prisma.wabaAccount.findMany.mockResolvedValue([{ id: 9, wabaId: 'branch-waba', accessToken: 'b', producerId: 1 }])

    await service.sync(9)

    expect(prisma.wabaAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 9, disconnectedAt: null }) }),
    )
    expect(campaigns.syncNewAccounts).toHaveBeenCalledWith(1)
  })
})

describe('TemplateSyncService switch', () => {
  it('does nothing unless META_TEMPLATE_SYNC_ENABLED is true', async () => {
    const { service, prisma } = setup({ env: { META_TEMPLATE_SYNC_ENABLED: '' } })

    await service.syncAll()
    service.syncAccountSoon(9)
    await new Promise(resolve => setImmediate(resolve))

    expect(prisma.wabaAccount.findMany).not.toHaveBeenCalled()
  })

  it('runs the connection pass in the background without throwing', async () => {
    const { service, templates } = setup()
    templates.createTemplate.mockRejectedValue(new Error('boom'))

    expect(() => service.syncAccountSoon(9)).not.toThrow()
    await new Promise(resolve => setImmediate(resolve))
  })
})
