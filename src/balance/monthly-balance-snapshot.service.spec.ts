import { BadRequestException, ConflictException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { MonthlyBalanceSnapshotService } from './monthly-balance-snapshot.service'

// Code 10 is the master (office line M1); code 20 answers on the branch line B1.
function createPrismaMock() {
  return {
    producer: { findMany: jest.fn().mockResolvedValue([{ id: 5, createdAt: new Date('2026-06-15T12:00:00Z') }]) },
    producerCode: {
      findMany: jest.fn().mockResolvedValue([
        { id: 10, isMaster: true },
        { id: 20, isMaster: false },
      ]),
    },
    phoneNumber: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, phoneNumberId: 'M1', responsibleProducerCodeId: 10 },
        { id: 2, phoneNumberId: 'B1', responsibleProducerCodeId: 20 },
      ]),
    },
    policy: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    installment: { findMany: jest.fn().mockResolvedValue([]) },
    claim: { groupBy: jest.fn().mockResolvedValue([]) },
    notification: { groupBy: jest.fn().mockResolvedValue([]) },
    quote: { groupBy: jest.fn().mockResolvedValue([]) },
    quoteRequest: { findMany: jest.fn().mockResolvedValue([]) },
    contactLead: { groupBy: jest.fn().mockResolvedValue([]) },
    conversation: { groupBy: jest.fn().mockResolvedValue([]) },
    usageMonthly: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRejection: { groupBy: jest.fn().mockResolvedValue([]) },
    policyExpiryNotice: { groupBy: jest.fn().mockResolvedValue([]) },
    monthlyBalance: {
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn((args: { where: unknown; create: unknown; update: unknown }) => args),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  }
}

const count = (n: number) => ({ _count: { _all: n } })

function setup(env: Record<string, string> = {}) {
  const prisma = createPrismaMock()
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService
  const service = new MonthlyBalanceSnapshotService(prisma as unknown as PrismaService, config)
  return { prisma, service }
}

/** 00:30 of 1 November in Argentina: October has just closed. */
const RIGHT_AFTER_OCTOBER = new Date('2026-11-01T03:30:00Z')

describe('MonthlyBalanceSnapshotService.computeOrganization', () => {
  function withMonthData(prisma: ReturnType<typeof createPrismaMock>) {
    prisma.policy.findMany.mockResolvedValue([
      { producerCodeId: 10, premium: 1000 },
      { producerCodeId: 20, premium: '500.50' },
      // Not attributed yet: the master code's, and a negative premium is no premium.
      { producerCodeId: null, premium: -3 },
    ])
    prisma.policy.groupBy
      .mockResolvedValueOnce([{ producerCodeId: 20, ...count(2) }]) // started in the month
      .mockResolvedValueOnce([{ producerCodeId: 10, ...count(1) }]) // ended in the month
    prisma.installment.findMany.mockResolvedValue([
      { amount: 100, status: 'overdue', policy: { producerCodeId: 20 } },
      { amount: -50, status: 'pending', policy: { producerCodeId: 20 } },
      { amount: 30, status: 'rejected', policy: { producerCodeId: 10 } },
    ])
    prisma.claim.groupBy
      .mockResolvedValueOnce([{ producerCodeId: 20, ...count(1) }]) // filed
      .mockResolvedValueOnce([{ producerCodeId: 20, ...count(4) }]) // open at the close
    prisma.notification.groupBy.mockResolvedValue([
      { producerCodeId: null, phoneNumberId: 'B1', blockedClaimReason: 'REJECTED_PAYMENT', ...count(2) },
      { producerCodeId: 10, phoneNumberId: 'M1', blockedClaimReason: null, ...count(5) },
    ])
    prisma.quote.groupBy.mockResolvedValue([
      // Quotes keep the master code by default: the branch line says who quoted.
      { producerCodeId: 10, phoneNumberId: 'B1', ...count(3) },
      { producerCodeId: 10, phoneNumberId: null, ...count(4) },
    ])
    prisma.quoteRequest.findMany.mockResolvedValue([
      { status: 'CLOSED', quote: { producerCodeId: 10, phoneNumberId: 'B1' } },
      { status: 'NEW', quote: { producerCodeId: 10, phoneNumberId: null } },
    ])
    prisma.contactLead.groupBy.mockResolvedValue([
      { producerCodeId: null, phoneNumberId: null, status: 'CLOSED', ...count(1) },
    ])
    prisma.conversation.groupBy.mockResolvedValue([{ producerCodeId: null, phoneNumberId: 'B1', ...count(6) }])
    prisma.usageMonthly.findMany.mockResolvedValue([{ producerCodeId: null, phoneNumberId: 2, metaMessages: 120 }])
    prisma.paymentRejection.groupBy.mockResolvedValue([{ producerCodeId: 20, ...count(2) }])
    prisma.policyExpiryNotice.groupBy.mockResolvedValue([{ producerCodeId: null, ...count(1) }])
  }

  it('adds up the month per producer code at the close', async () => {
    const { prisma, service } = setup()
    withMonthData(prisma)

    const result = await service.computeOrganization(5, '2026-10', true)

    expect(result.get(20)).toEqual({
      policiesInForce: 1,
      policiesNew: 2,
      policiesLost: 0,
      premiumInForce: 500.5,
      debtAmount: 100,
      installmentsOverdue: 1,
      installmentsRejected: 0,
      claimsFiled: 1,
      claimsOpen: 4,
      claimsBlockedNoPolicy: 0,
      claimsBlockedRejectedPayment: 2,
      claimsBlockedOverdue: 0,
      quotesBot: 3,
      quotesWeb: 0,
      quoteRequests: 1,
      contactLeads: 0,
      requestsClosed: 1,
      handoffs: 2,
      conversationsNew: 6,
      messagesSent: 120,
      rejectionNoticesSent: 2,
      expiryNoticesSent: 0,
    })
    expect(result.get(10)).toMatchObject({
      policiesInForce: 2,
      policiesLost: 1,
      premiumInForce: 1000,
      debtAmount: 30,
      installmentsRejected: 1,
      claimsFiled: 0,
      handoffs: 5,
      claimsBlockedRejectedPayment: 0,
      quotesBot: 0,
      quotesWeb: 4,
      quoteRequests: 1,
      contactLeads: 1,
      requestsClosed: 1,
      expiryNoticesSent: 1,
    })
  })

  it('reads timestamps by the month in Argentina and policy dates by its calendar days', async () => {
    const { prisma, service } = setup()
    await service.computeOrganization(5, '2026-10', true)

    const month = { gte: new Date('2026-10-01T03:00:00Z'), lt: new Date('2026-11-01T03:00:00Z') }
    expect(prisma.claim.groupBy.mock.calls[0][0].where).toEqual({ producerId: 5, deletedAt: null, createdAt: month })
    expect(prisma.policy.findMany.mock.calls[0][0].where).toMatchObject({
      producerId: 5,
      deletedAt: null,
      validTo: { gte: new Date('2026-11-01T00:00:00Z') },
      OR: [{ validFrom: null }, { validFrom: { lt: new Date('2026-11-01T00:00:00Z') } }],
    })
    expect(prisma.policy.groupBy.mock.calls[0][0].where).toMatchObject({
      validFrom: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') },
    })
    // A handoff cleared from Asuntos pendientes still happened.
    expect(prisma.notification.groupBy.mock.calls[0][0].where).toEqual({
      producerId: 5,
      type: 'handoff',
      createdAt: month,
    })
  })

  it('rebuilds a past month with the month-end state left null, never 0', async () => {
    const { prisma, service } = setup()
    withMonthData(prisma)

    const result = await service.computeOrganization(5, '2026-10', false)

    expect(prisma.installment.findMany).not.toHaveBeenCalled()
    expect(prisma.claim.groupBy).toHaveBeenCalledTimes(1)
    expect(result.get(20)).toMatchObject({
      policiesInForce: 1,
      claimsFiled: 1,
      premiumInForce: null,
      debtAmount: null,
      installmentsOverdue: null,
      installmentsRejected: null,
      claimsOpen: null,
      requestsClosed: null,
    })
  })

  it('writes nothing for an organization without codes', async () => {
    const { prisma, service } = setup()
    prisma.producerCode.findMany.mockResolvedValue([])
    await expect(service.computeOrganization(5, '2026-10', true)).resolves.toEqual(new Map())
    expect(prisma.policy.findMany).not.toHaveBeenCalled()
  })
})

describe('MonthlyBalanceSnapshotService.snapshotPeriod', () => {
  it('closes the month just ended with its month-end state', async () => {
    const { prisma, service } = setup()
    const result = await service.snapshotPeriod('2026-10', { now: RIGHT_AFTER_OCTOBER })

    expect(result).toEqual({ period: '2026-10', monthEnd: true, organizations: [{ producerId: 5, rows: 2 }] })
    expect(prisma.monthlyBalance.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.monthlyBalance.upsert.mock.calls[0][0]).toMatchObject({
      where: { producerId_producerCodeId_period: { producerId: 5, producerCodeId: 10, period: '2026-10' } },
      create: { producerId: 5, producerCodeId: 10, period: '2026-10', backfilled: false, debtAmount: 0 },
    })
  })

  it('marks a month written days later as rebuilt', async () => {
    const { prisma, service } = setup()
    const result = await service.snapshotPeriod('2026-10', { now: new Date('2026-11-04T12:00:00Z') })

    expect(result.monthEnd).toBe(false)
    expect(prisma.monthlyBalance.upsert.mock.calls[0][0].create).toMatchObject({ backfilled: true, debtAmount: null })
  })

  it('never rewrites a closed month unless forced', async () => {
    const { prisma, service } = setup()
    prisma.monthlyBalance.count.mockResolvedValue(2)

    const kept = await service.snapshotPeriod('2026-10', { now: RIGHT_AFTER_OCTOBER })
    expect(kept.organizations).toEqual([{ producerId: 5, rows: 0, skipped: 'already_closed' }])
    expect(prisma.monthlyBalance.upsert).not.toHaveBeenCalled()

    const forced = await service.snapshotPeriod('2026-10', { now: RIGHT_AFTER_OCTOBER, force: true })
    expect(forced.organizations).toEqual([{ producerId: 5, rows: 2 }])
    expect(prisma.monthlyBalance.upsert.mock.calls[0][0].update).toMatchObject({ deletedAt: null, backfilled: false })
  })

  it('leaves the months before the organization existed without data', async () => {
    const { prisma, service } = setup()
    const result = await service.snapshotPeriod('2026-05', { now: RIGHT_AFTER_OCTOBER })

    expect(result.organizations).toEqual([{ producerId: 5, rows: 0, skipped: 'not_created_yet' }])
    expect(prisma.policy.findMany).not.toHaveBeenCalled()
  })

  it('refuses a month that has not ended', async () => {
    const { service } = setup()
    await expect(service.snapshotPeriod('2026-11', { now: RIGHT_AFTER_OCTOBER })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('takes one organization when asked, active or not', async () => {
    const { prisma, service } = setup()
    await service.snapshotPeriod('2026-10', { now: RIGHT_AFTER_OCTOBER, producerId: 5 })
    expect(prisma.producer.findMany.mock.calls[0][0].where).toEqual({ id: 5, deletedAt: null })
  })
})

describe('MonthlyBalanceSnapshotService backfill and runs', () => {
  it('fills the last closed months, oldest first', async () => {
    const { service } = setup()
    const results = await service.backfill(3, RIGHT_AFTER_OCTOBER)

    expect(results.map(r => [r.period, r.monthEnd])).toEqual([
      ['2026-08', false],
      ['2026-09', false],
      ['2026-10', true],
    ])
  })

  it('runs one job at a time', async () => {
    const { prisma, service } = setup()
    let release: () => void = () => undefined
    prisma.producer.findMany.mockImplementationOnce(() => new Promise(resolve => (release = () => resolve([]))))

    const first = service.runForOwner({ period: '2026-01' })
    await expect(service.runForOwner({ period: '2026-01' })).rejects.toBeInstanceOf(ConflictException)
    release()
    await expect(first).resolves.toMatchObject({ period: '2026-01', organizations: [] })
  })

  it('stays off when MONTHLY_BALANCE_ENABLED is false', async () => {
    const { prisma, service } = setup({ MONTHLY_BALANCE_ENABLED: 'false' })
    service.onApplicationBootstrap()
    await service.closeMonth()
    expect(prisma.producer.findMany).not.toHaveBeenCalled()
  })
})
