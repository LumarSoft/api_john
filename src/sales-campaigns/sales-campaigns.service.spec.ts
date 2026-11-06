import { ConflictException, ForbiddenException } from '@nestjs/common'
import { Role, SalesCampaignKind } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { BotNotifierService } from '../inbox/bot-notifier.service'
import type { NoticeDeliveryService } from '../notices/notice-delivery.service'
import type { PlanFeaturesService } from '../plan-features/plan-features.service'
import { allFeatures } from '../plan-features/plan-features'
import type { CampaignFinderService, CampaignTarget } from './campaign-finder.service'
import type { CampaignTemplatesService } from './campaign-templates.service'
import { CampaignTemplatesService as RealTemplates } from './campaign-templates.service'
import { SalesCampaignsService } from './sales-campaigns.service'

const mili = { id: 2, producerId: 7, role: Role.ADMIN }
const NOW = new Date('2026-11-04T15:00:00Z')

/** Someone the renewal campaign finds (fictitious data). */
function target(overrides: Partial<CampaignTarget> = {}): CampaignTarget {
  return {
    id: 100,
    clientId: 60,
    name: 'Juan Perez',
    firstName: 'Juan',
    dni: '20999001',
    phone: '341159990001',
    waId: null,
    conversationId: null,
    item: 'Ford Ka 2015 · AB123CD',
    bien: 'Ford Ka',
    detail: 'Vence el 20/11/2026',
    date: new Date('2026-11-20T12:00:00Z'),
    sortDate: new Date('2026-11-20T12:00:00Z'),
    coverages: ['B1'],
    reason: null,
    producerCodeId: 3,
    producerCode: { id: 3, code: '11425' },
    ...overrides,
  }
}

const APPROVED = {
  '6': { name: 'campana_renovacion_v2', id: 't', status: 'APPROVED', reason: null, checkedAt: NOW.toISOString() },
}

function setup({ row = {}, targets = [target()], messages = [] as unknown[], optOuts = [] as unknown[] } = {}) {
  const campaign = {
    id: 5,
    kind: SalesCampaignKind.RENEWAL,
    enabled: true,
    discountPercent: 20,
    body: '¡Hola, {nombre}! Tu {bien} vence el {vencimiento}: {porcentaje}% de beneficio. ¿Lo vemos?',
    settings: null,
    templateVersion: 2,
    templates: APPROVED,
    producerId: 7,
    updatedAt: NOW,
    ...row,
  }
  const prisma = {
    salesCampaign: {
      findFirst: jest.fn().mockResolvedValue(campaign),
      findMany: jest.fn().mockResolvedValue([campaign]),
      findUnique: jest.fn().mockResolvedValue({ templates: campaign.templates }),
      upsert: jest.fn().mockResolvedValue(campaign),
      update: jest.fn().mockResolvedValue(campaign),
    },
    salesCampaignMessage: {
      findMany: jest.fn().mockResolvedValue(messages),
      create: jest.fn().mockResolvedValue({ id: 900 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 900,
        waId: '5493419990001',
        producerId: 7,
        producerCodeId: 3,
        clientId: 60,
        policyId: 100,
        quoteId: null,
        discountPercent: 20,
      }),
    },
    salesCampaignOptOut: { findMany: jest.fn().mockResolvedValue(optOuts), upsert: jest.fn() },
  }
  const finder = { find: jest.fn().mockResolvedValue(targets) }
  const templates = {
    accounts: jest
      .fn()
      .mockResolvedValue([{ id: 6, wabaId: 'w', wabaName: 'Oficina', accessToken: 'x', numbers: ['+54 9 341'] }]),
    submit: jest.fn().mockResolvedValue({
      '6': { name: 'campana_renovacion_v3', id: null, status: 'PENDING', reason: null, checkedAt: '' },
    }),
    refresh: jest.fn(),
    hasPending: jest.fn().mockReturnValue(false),
    view: RealTemplates.prototype.view,
    approvedAccounts: RealTemplates.prototype.approvedAccounts,
  }
  const planFeatures = {
    forUser: jest.fn().mockResolvedValue({ features: allFeatures(), availableIn: {}, blockedByRole: [] }),
    assertRole: jest.fn().mockResolvedValue(undefined),
  }
  const delivery = {
    senders: jest.fn().mockResolvedValue([
      { phoneNumberId: 'meta-office', codeIds: [3], wabaAccountId: 6 },
      { phoneNumberId: 'meta-branch', codeIds: [9], wabaAccountId: 8 },
    ]),
    knownWaIds: jest.fn().mockResolvedValue(new Set()),
    findConversation: jest.fn().mockResolvedValue(null),
    recordInChat: jest.fn().mockResolvedValue(40),
  }
  const botNotifier = { sendTemplate: jest.fn().mockResolvedValue(undefined) }
  const service = new SalesCampaignsService(
    prisma as unknown as PrismaService,
    finder as unknown as CampaignFinderService,
    templates as unknown as CampaignTemplatesService,
    planFeatures as unknown as PlanFeaturesService,
    delivery as unknown as NoticeDeliveryService,
    botNotifier as unknown as BotNotifierService,
  )
  return { service, prisma, finder, templates, planFeatures, delivery, botNotifier }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('SalesCampaignsService.send', () => {
  it('writes with the template of the sender’s account, the values in order, and leaves it in the chat', async () => {
    const { service, delivery, botNotifier, prisma } = setup()

    await expect(service.send(mili, 'renewal', [3], [100], NOW)).resolves.toEqual({ sent: 1, skipped: [] })
    await flush()

    // Only numbers whose plan includes the campaign...
    expect(delivery.senders).toHaveBeenCalledWith(7, 'campaign_renewal')
    expect(botNotifier.sendTemplate).toHaveBeenCalledWith({
      to: '5493419990001',
      phoneNumberId: 'meta-office',
      template: 'campana_renovacion_v2',
      lang: 'es_AR',
      params: ['Juan', 'Ford Ka', '20/11/2026', '20'],
    })
    expect(delivery.recordInChat).toHaveBeenCalledWith(
      expect.objectContaining({ waId: '5493419990001', clientId: 60 }),
      null,
      'meta-office',
      '¡Hola, Juan! Tu Ford Ka vence el 20/11/2026: 20% de beneficio. ¿Lo vemos?',
      { salesCampaignMessageId: 900, campaign: 'renewal', notice: 'sales_campaign' },
    )
    expect(prisma.salesCampaignMessage.update).toHaveBeenLastCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'SENT', conversationId: 40 }),
    })
  })

  it('leaves out who got it within the cooldown, who opted out and who has no WhatsApp', async () => {
    const { service, prisma } = setup({
      targets: [
        target({ id: 1, clientId: 61 }),
        target({ id: 2, clientId: 62, phone: '341159990002' }),
        target({ id: 3, clientId: 63, phone: null }),
        target({ id: 4, clientId: 64, phone: '341159990004' }),
      ],
      messages: [
        {
          status: 'SENT',
          sentAt: NOW,
          createdAt: new Date('2026-10-20T12:00:00Z'),
          clientId: 61,
          waId: null,
          policyId: 50,
          quoteId: null,
          error: null,
        },
      ],
      optOuts: [{ waId: '5493419990002' }],
    })

    const result = await service.send(mili, 'renewal', [3], [1, 2, 3, 4], NOW)

    expect(result).toEqual({
      sent: 1,
      skipped: [
        { id: 1, reason: 'ALREADY_SENT' },
        { id: 2, reason: 'OPTED_OUT' },
        { id: 3, reason: 'NO_PHONE' },
      ],
    })
    expect(prisma.salesCampaignMessage.create).toHaveBeenCalledTimes(1)
  })

  it('does not send while the campaign is off or Meta has not approved its message', async () => {
    const off = setup({ row: { enabled: false } })
    await expect(off.service.send(mili, 'renewal', [3], [100], NOW)).rejects.toThrow(ConflictException)

    const pending = setup({ row: { templates: { '6': { ...APPROVED['6'], status: 'PENDING' } } } })
    await expect(pending.service.send(mili, 'renewal', [3], [100], NOW)).rejects.toThrow('aprobó')
    expect(pending.prisma.salesCampaignMessage.create).not.toHaveBeenCalled()
  })
})

describe('SalesCampaignsService.update', () => {
  it('sends a new text to Meta as a new version, and keeps the template when only the percentage changes', async () => {
    const { service, templates, prisma } = setup()

    await service.update(mili, 'renewal', { body: 'Hola {nombre}, tu {bien} vence pronto. ¿Lo vemos?' }, [3])
    expect(templates.submit).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ kind: 'renewal' }),
      'Hola {nombre}, tu {bien} vence pronto. ¿Lo vemos?',
      3,
    )
    expect(prisma.salesCampaign.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ templateVersion: 3 }) }),
    )

    templates.submit.mockClear()
    await service.update(mili, 'renewal', { discountPercent: 10 }, [3])
    expect(templates.submit).not.toHaveBeenCalled()
  })

  it('does not turn on a campaign the plan leaves out', async () => {
    const { service, planFeatures } = setup({ row: { enabled: false } })
    planFeatures.forUser.mockResolvedValue({
      features: { ...allFeatures(), campaign_renewal: false },
      availableIn: { campaign_renewal: 'Empresa' },
      blockedByRole: [],
    })

    await expect(service.update(mili, 'renewal', { enabled: true }, [3])).rejects.toThrow(ForbiddenException)
  })
})

describe('SalesCampaignsService.syncNewAccounts', () => {
  const office = { id: 6, wabaId: 'w', wabaName: 'Oficina', accessToken: 'x', numbers: ['+54 9 341'] }
  const branch = { id: 9, wabaId: 'b', wabaName: 'Sucursal', accessToken: 'y', numbers: ['+54 9 3492'] }

  it("sends the current text to an account connected after it, keeping the others' reviews", async () => {
    const { service, templates, prisma } = setup()
    templates.accounts.mockResolvedValue([office, branch])
    const pending = { name: 'campana_renovacion_v2', id: null, status: 'PENDING', reason: null, checkedAt: '' }
    templates.submit.mockResolvedValue({ '9': pending })

    await expect(service.syncNewAccounts(7)).resolves.toBe(1)

    expect(prisma.salesCampaign.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, templateVersion: { gt: 0 }, producerId: 7 },
    })
    expect(templates.submit).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ kind: 'renewal' }),
      expect.stringContaining('{nombre}'),
      2,
      [branch],
    )
    expect(prisma.salesCampaign.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { templates: { ...APPROVED, '9': pending } },
    })
  })

  it('does nothing when every account has the text', async () => {
    const { service, templates, prisma } = setup()

    await expect(service.syncNewAccounts()).resolves.toBe(0)
    expect(templates.submit).not.toHaveBeenCalled()
    expect(prisma.salesCampaign.update).not.toHaveBeenCalled()
  })

  it('sends again, once a day, a text that never reached Meta', async () => {
    const failedAt = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
    const failed = (hoursAgo: number) => ({
      '6': { name: 'campana_renovacion_v2', id: null, status: 'ERROR', reason: 'x', checkedAt: failedAt(hoursAgo) },
    })

    const recent = setup({ row: { templates: failed(2) } })
    await expect(recent.service.syncNewAccounts()).resolves.toBe(0)

    const old = setup({ row: { templates: failed(30) } })
    await expect(old.service.syncNewAccounts()).resolves.toBe(1)
    expect(old.templates.submit).toHaveBeenCalledWith(7, expect.anything(), expect.any(String), 2, [office])
  })
})

describe('SalesCampaignsService.candidates', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

  it('lists who entered the list last first, and the oldest first when asked', async () => {
    const targets = [
      target({ id: 1, sortDate: day('2026-08-01') }),
      target({ id: 2, sortDate: day('2026-11-01') }),
      target({ id: 3, sortDate: day('2026-10-01') }),
    ]
    const { service } = setup({ targets })

    const recent = await service.candidates(mili, 'coverage_upgrade', [3], {}, NOW)
    expect(recent.data.map(r => r.id)).toEqual([2, 3, 1])

    expect(recent.sort).toEqual({ by: 'date', order: 'desc' })

    // What the panels sent before the headers could sort.
    const oldest = await service.candidates(mili, 'coverage_upgrade', [3], { sort: 'oldest' }, NOW)
    expect(oldest.data.map(r => r.id)).toEqual([1, 3, 2])
    expect(oldest.sort).toEqual({ by: 'date', order: 'asc' })
  })

  it('lists renewals by the soonest to end first, the most urgent', async () => {
    const targets = [
      target({ id: 1, sortDate: day('2026-12-01') }),
      target({ id: 2, sortDate: day('2026-11-10') }),
      target({ id: 3, sortDate: day('2026-11-20') }),
    ]
    const { service } = setup({ targets })

    const result = await service.candidates(mili, 'renewal', [3], {}, NOW)
    expect(result.data.map(r => r.id)).toEqual([2, 3, 1])
    expect(result.sort).toEqual({ by: 'date', order: 'asc' })
  })

  it('sorts by the column the office taps, A to Z first, and back', async () => {
    const targets = [
      target({ id: 1, name: 'Zoe Ruiz' }),
      target({ id: 2, name: 'ana Paz' }),
      target({ id: 3, name: 'Bruno Diaz' }),
    ]
    const { service } = setup({ targets })

    const az = await service.candidates(mili, 'coverage_upgrade', [3], { sort: 'name' }, NOW)
    expect(az.data.map(r => r.id)).toEqual([2, 3, 1])
    expect(az.sort).toEqual({ by: 'name', order: 'asc' })

    const za = await service.candidates(mili, 'coverage_upgrade', [3], { sort: 'name', order: 'desc' }, NOW)
    expect(za.data.map(r => r.id)).toEqual([1, 3, 2])
  })

  it('sorted by last message, puts the latest contact first and who never got one last', async () => {
    const targets = [target({ id: 1, clientId: 61 }), target({ id: 2, clientId: 62 }), target({ id: 3, clientId: 63 })]
    const at = (iso: string) => new Date(iso)
    const messages = [
      { status: 'SENT', sentAt: at('2026-11-03T12:00:00Z'), createdAt: NOW, error: null, clientId: 61, policyId: 1 },
      { status: 'MARKED', sentAt: null, createdAt: at('2026-11-01T12:00:00Z'), error: null, clientId: 63, policyId: 3 },
    ]
    const { service } = setup({ targets, messages })

    const latest = await service.candidates(mili, 'coverage_upgrade', [3], { sort: 'lastMessage' }, NOW)
    expect(latest.data.map(r => r.id)).toEqual([1, 3, 2])

    const never = await service.candidates(mili, 'coverage_upgrade', [3], { sort: 'lastMessage', order: 'asc' }, NOW)
    expect(never.data.map(r => r.id)).toEqual([2, 3, 1])
  })

  it('keeps who was already written to at the end, however recent', async () => {
    const targets = [
      target({ id: 1, clientId: 61, sortDate: day('2026-08-01') }),
      target({ id: 2, clientId: 62, sortDate: day('2026-11-01') }),
    ]
    const messages = [{ status: 'SENT', sentAt: NOW, createdAt: NOW, error: null, clientId: 62, policyId: 2 }]
    const { service } = setup({ targets, messages })

    const result = await service.candidates(mili, 'coverage_upgrade', [3], {}, NOW)
    expect(result.data.map(r => r.id)).toEqual([1, 2])
  })

  it('narrows by coverage and offers the coverages found, with how many each', async () => {
    const targets = [
      target({ id: 1, coverages: ['A'] }),
      target({ id: 2, coverages: ['B1'] }),
      target({ id: 3, coverages: ['C2 Full', 'A'] }),
    ]
    const { service } = setup({ targets })

    const result = await service.candidates(mili, 'cross_sell', [3], { coverage: 'a' }, NOW)
    expect(result.data.map(r => r.id).sort()).toEqual([1, 3])
    expect(result.total).toBe(2)
    expect(result.filters).toEqual({
      coverages: [
        { value: 'A', count: 2 },
        { value: 'B1', count: 1 },
        { value: 'C2 Full', count: 1 },
      ],
      reasons: null,
    })
  })

  it('narrows the winback list by why the policy was cancelled', async () => {
    const targets = [
      target({ id: 1, reason: 'falta_pago' }),
      target({ id: 2, reason: 'venta' }),
      target({ id: 3, reason: 'falta_pago' }),
    ]
    const { service } = setup({ targets })

    const result = await service.candidates(mili, 'winback', [3], { reason: 'venta' }, NOW)
    expect(result.data.map(r => r.id)).toEqual([2])
    expect(result.filters).toEqual({
      coverages: null,
      reasons: [
        { value: 'falta_pago', label: 'Falta de pago', count: 2 },
        { value: 'venta', label: 'Venta del bien', count: 1 },
      ],
    })
  })
})
