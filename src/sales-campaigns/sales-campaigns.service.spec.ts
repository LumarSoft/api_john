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
    forUser: jest.fn().mockResolvedValue({ features: allFeatures(), availableIn: {} }),
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
    })

    await expect(service.update(mili, 'renewal', { enabled: true }, [3])).rejects.toThrow(ForbiddenException)
  })
})
