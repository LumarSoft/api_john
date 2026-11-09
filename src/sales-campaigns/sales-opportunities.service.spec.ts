import { BadRequestException } from '@nestjs/common'
import { Prisma, Role, SalesCampaignKind } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { CAMPAIGNS } from './campaign-catalog'
import type { CampaignTarget } from './campaign-finder.service'
import { SalesOpportunitiesService, targetKeyOf } from './sales-opportunities.service'

const mili = { id: 2, producerId: 7, role: Role.ADMIN }
const NOW = new Date('2026-11-09T15:00:00Z')
const CONTACT = new Date('2026-11-07T19:46:00Z')

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
    item: 'Bajaj Rouser 250 N 2024 · A123BCD',
    bien: 'Bajaj Rouser',
    detail: 'Cotizó el 06/11/2026',
    date: null,
    sortDate: null,
    coverages: [],
    reason: null,
    producerCodeId: 3,
    producerCode: { id: 3, code: '11425' },
    ...overrides,
  }
}

/** An open opportunity as the tracker reads it. */
function open(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: 'CONTACTED',
    campaignId: 5,
    producerId: 7,
    clientId: 60,
    policyId: 100,
    quoteId: null,
    contactedAt: CONTACT,
    repliedAt: null,
    quotedAt: null,
    createdAt: CONTACT,
    campaign: { kind: SalesCampaignKind.CROSS_SELL, settings: null },
    policy: {
      riskType: 'auto',
      validTo: null,
      updatedAt: CONTACT,
      vehicle: { licensePlate: 'AB123CD', coverage: 'A' },
    },
    quote: null,
    ...overrides,
  }
}

function setup() {
  const prisma = {
    salesOpportunity: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 1,
          targetKey: 'policy:100',
          status: data.status ?? 'CONTACTED',
          contactedAt: CONTACT,
          repliedAt: null,
          quotedAt: null,
          wonAt: (data.wonAt as Date | null) ?? null,
          lostAt: (data.lostAt as Date | null) ?? null,
          lostReason: (data.lostReason as string | null) ?? null,
          note: (data.note as string | null) ?? null,
          wonPremium: data.wonPremium == null ? null : new Prisma.Decimal(data.wonPremium as number),
          assignedAt: null,
          assignedTo: null,
          campaignId: 5,
          clientId: 60,
          producerCodeId: 3,
          policyId: 100,
          quoteId: null,
        }),
      ),
      upsert: jest.fn().mockResolvedValue({
        id: 1,
        targetKey: 'policy:100',
        status: 'CONTACTED',
        contactedAt: CONTACT,
        repliedAt: null,
        quotedAt: null,
        wonAt: null,
        lostAt: null,
        lostReason: null,
        note: null,
        wonPremium: null,
        assignedAt: null,
        assignedTo: null,
        campaignId: 5,
        clientId: 60,
        producerCodeId: 3,
        policyId: 100,
        quoteId: null,
      }),
    },
    salesCampaign: { findMany: jest.fn().mockResolvedValue([{ id: 5, kind: SalesCampaignKind.CROSS_SELL }]) },
    salesCampaignMessage: {
      findFirst: jest.fn().mockResolvedValue({ conversationId: 40 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    conversation: { findUnique: jest.fn().mockResolvedValue({ clientId: 60 }) },
    message: { findFirst: jest.fn().mockResolvedValue(null) },
    quote: { findFirst: jest.fn().mockResolvedValue(null) },
    policy: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
  }
  const service = new SalesOpportunitiesService(prisma as unknown as PrismaService)
  return { service, prisma }
}

describe('targetKeyOf', () => {
  it('follows the policy, or the quote in Cotizaciones sin cerrar', () => {
    expect(targetKeyOf(CAMPAIGNS.renewal, 100)).toBe('policy:100')
    expect(targetKeyOf(CAMPAIGNS.quote_followup, 55)).toBe('quote:55')
  })
})

describe('SalesOpportunitiesService.contacted', () => {
  it('opens the opportunity for whoever sent the message', async () => {
    const { service, prisma } = setup()

    await service.contacted(5, 7, CAMPAIGNS.renewal, [target()], 2, NOW)

    expect(prisma.salesOpportunity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 5,
        producerId: 7,
        targetKey: 'policy:100',
        policyId: 100,
        clientId: 60,
        producerCodeId: 3,
        status: 'CONTACTED',
        contactedAt: NOW,
        assignedToId: 2,
        assignedAt: NOW,
      }),
    })
  })

  it('leaves a closed one as it was, and only fills in the assignee when nobody follows it', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findUnique.mockResolvedValue({ id: 1, status: 'WON', assignedToId: null, deletedAt: null })

    await service.contacted(5, 7, CAMPAIGNS.renewal, [target()], 2, NOW)

    expect(prisma.salesOpportunity.create).not.toHaveBeenCalled()
    const { data } = prisma.salesOpportunity.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data.status).toBeUndefined()
    expect(data.assignedToId).toBe(2)
  })
})

describe('SalesOpportunitiesService.update', () => {
  it('refuses to lose an opportunity without a reason', async () => {
    const { service } = setup()

    await expect(service.update(mili, 5, CAMPAIGNS.renewal, target(), { status: 'LOST' }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('closes it as won with the premium, assigned to whoever closed it', async () => {
    const { service, prisma } = setup()

    const view = await service.update(mili, 5, CAMPAIGNS.renewal, target(), { status: 'WON', wonPremium: 85000 }, NOW)

    const { data } = prisma.salesOpportunity.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toEqual(
      expect.objectContaining({ status: 'WON', wonAt: NOW, wonPremium: 85000, assignedToId: 2, lostReason: null }),
    )
    expect(view.status).toBe('WON')
    expect(view.statusLabel).toBe('Ganada')
    expect(view.wonPremium).toBe(85000)
  })

  it('checks the assignee is someone of the office', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)

    await expect(
      service.update(mili, 5, CAMPAIGNS.renewal, target(), { assignedToId: 99 }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 99, producerId: 7, role: { not: 'OWNER' } }) }),
    )
  })
})

describe('SalesOpportunitiesService.track', () => {
  it('moves to REPLIED when the customer answered in the chat after the contact', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findMany.mockResolvedValue([open()])
    prisma.message.findFirst.mockResolvedValue({ createdAt: new Date('2026-11-08T12:00:00Z') })

    await expect(service.track(7, NOW)).resolves.toBe(1)

    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: 40, role: 'user', createdAt: { gt: CONTACT } }),
      }),
    )
    expect(prisma.salesOpportunity.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { repliedAt: new Date('2026-11-08T12:00:00Z'), status: 'REPLIED' },
    })
  })

  it('moves to QUOTED on a quote asked in that chat, and to WON when the cartera brings the home policy', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findMany.mockResolvedValue([open()])
    prisma.quote.findFirst.mockResolvedValue({ id: 77, createdAt: new Date('2026-11-08T13:00:00Z') })
    prisma.policy.findMany.mockResolvedValue([
      {
        id: 300,
        riskType: 'auto',
        validFrom: null,
        premium: null,
        createdAt: new Date('2026-11-09T09:00:00Z'),
        vehicle: null,
      },
      {
        id: 301,
        riskType: 'home',
        validFrom: null,
        premium: new Prisma.Decimal('120000.50'),
        createdAt: new Date('2026-11-09T09:00:00Z'),
        vehicle: null,
      },
    ])

    await service.track(7, NOW)

    expect(prisma.salesOpportunity.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        quotedAt: new Date('2026-11-08T13:00:00Z'),
        wonQuoteId: 77,
        wonAt: new Date('2026-11-09T09:00:00Z'),
        wonPolicyId: 301,
        wonPremium: new Prisma.Decimal('120000.50'),
        status: 'WON',
      }),
    })
    // Never the old policy itself.
    expect(prisma.policy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: 60, id: { not: 100 } }) }),
    )
  })

  it('takes a renewal only for the same vehicle, starting around the old end', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findMany.mockResolvedValue([
      open({
        campaign: { kind: SalesCampaignKind.RENEWAL, settings: null },
        policy: {
          riskType: 'auto',
          validTo: new Date('2026-11-20T00:00:00Z'),
          updatedAt: CONTACT,
          vehicle: { licensePlate: 'AB 123 CD', coverage: 'B1' },
        },
      }),
    ])
    prisma.policy.findMany.mockResolvedValue([
      {
        id: 310,
        riskType: 'auto',
        validFrom: new Date('2026-11-20T00:00:00Z'),
        premium: null,
        createdAt: new Date('2026-11-09T09:00:00Z'),
        vehicle: { licensePlate: 'ZZ999AA', coverage: 'B1' },
      },
      {
        id: 311,
        riskType: 'auto',
        validFrom: new Date('2026-11-21T00:00:00Z'),
        premium: new Prisma.Decimal(90000),
        createdAt: new Date('2026-11-09T10:00:00Z'),
        vehicle: { licensePlate: 'AB123CD', coverage: 'C' },
      },
    ])

    await service.track(7, NOW)

    expect(prisma.salesOpportunity.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ wonPolicyId: 311, status: 'WON' }),
    })
  })

  it('counts a better coverage on the same policy as the win of Mejora de coberturas', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findMany.mockResolvedValue([
      open({
        campaign: { kind: SalesCampaignKind.COVERAGE_UPGRADE, settings: null },
        policy: {
          riskType: 'auto',
          validTo: null,
          updatedAt: new Date('2026-11-09T06:00:00Z'),
          vehicle: { licensePlate: 'AB123CD', coverage: 'C2 Full' },
        },
      }),
    ])
    prisma.policy.findUnique.mockResolvedValue({
      premium: new Prisma.Decimal(99000),
      updatedAt: new Date('2026-11-09T06:00:00Z'),
    })

    await service.track(7, NOW)

    expect(prisma.salesOpportunity.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ wonPolicyId: 100, wonPremium: new Prisma.Decimal(99000), status: 'WON' }),
    })
  })

  it('leaves it alone when nothing happened', async () => {
    const { service, prisma } = setup()
    prisma.salesOpportunity.findMany.mockResolvedValue([open()])

    await expect(service.track(7, NOW)).resolves.toBe(0)
    expect(prisma.salesOpportunity.update).not.toHaveBeenCalled()
  })
})

describe('SalesOpportunitiesService.results', () => {
  it('counts the period by campaign and by person, with the premium of what was sold', async () => {
    const { service, prisma } = setup()
    const vane = { id: 4, name: 'Vanesa' }
    prisma.salesOpportunity.findMany.mockResolvedValue([
      {
        campaignId: 5,
        status: 'WON',
        repliedAt: NOW,
        quotedAt: NOW,
        wonPremium: new Prisma.Decimal(100000),
        assignedTo: vane,
      },
      { campaignId: 5, status: 'LOST', repliedAt: NOW, quotedAt: null, wonPremium: null, assignedTo: vane },
      { campaignId: 5, status: 'CONTACTED', repliedAt: null, quotedAt: null, wonPremium: null, assignedTo: null },
    ])
    prisma.salesCampaignMessage.findMany.mockResolvedValue([
      { campaignId: 5, status: 'SENT' },
      { campaignId: 5, status: 'SENT' },
      { campaignId: 5, status: 'MARKED' },
    ])

    const result = await service.results(mili, [3], { from: '2026-10-01', to: '2026-11-09' }, NOW)

    // The tracker ran first.
    expect(prisma.salesOpportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['CONTACTED', 'REPLIED', 'QUOTED'] } }),
      }),
    )
    const crossSell = result.campaigns.find(c => c.kind === 'cross_sell')
    expect(crossSell).toEqual(
      expect.objectContaining({
        sent: 2,
        marked: 1,
        contacted: 3,
        replied: 2,
        quoted: 1,
        won: 1,
        lost: 1,
        open: 1,
        premium: 100000,
      }),
    )
    expect(result.totals).toEqual(expect.objectContaining({ contacted: 3, won: 1, premium: 100000 }))
    expect(result.byAssignee[0]).toEqual(expect.objectContaining({ user: vane, contacted: 2, won: 1, lost: 1 }))
    expect(result.byAssignee[1]).toEqual(expect.objectContaining({ user: null, contacted: 1 }))
    // The whole last day, Argentina time.
    expect(result.to).toBe('2026-11-10T02:59:59.999Z')
    expect(result.from).toBe('2026-10-01T03:00:00.000Z')
  })

  it('scopes to the user’s codes and the person asked for', async () => {
    const { service, prisma } = setup()

    await service.results(mili, [3, 9], { assignedToId: 4 }, NOW)

    expect(prisma.salesOpportunity.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ producerCodeId: { in: [3, 9] }, assignedToId: 4, status: { not: 'NEW' } }),
      }),
    )
  })
})
