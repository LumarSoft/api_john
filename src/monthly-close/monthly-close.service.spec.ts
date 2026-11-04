import { BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { UsageService } from '../usage/usage.service'
import { isBackfill, MonthlyCloseService, previousPeriod } from './monthly-close.service'

const plans = [
  { id: 9, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true },
  { id: 1, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true },
  { id: 2, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true },
]

const usageRow = (values: Record<string, number>) => ({
  metaMessages: 0,
  metaTemplateMessages: 0,
  templateExtraMessages: 0,
  metaBillableMessages: 0,
  metaCostUsd: 0,
  openaiCostUsd: 0,
  ...values,
})

const phone = (overrides: Record<string, unknown>) => ({
  number: '+54 9 341 000-0000',
  isActive: true,
  planId: null,
  planUpgradedAt: null,
  planPausedAt: null,
  extraBlocks: 0,
  extraBlocksPeriod: null,
  responsibleProducerCodeId: 7,
  responsibleProducerCode: { code: '11425', holderName: null },
  usageMonthly: [],
  ...overrides,
})

/** 00:00:30 of 1 November 2026 in Argentina: October has just ended. */
const firstOfNovember = new Date('2026-11-01T03:00:30Z')

function setup(settings: Record<string, string> = {}) {
  const prisma = {
    producer: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Organización',
          isActive: true,
          phoneNumbers: [
            // On Inicial since September: 400 sent, 50 of them templates counted twice = 450 consumed.
            phone({
              id: 8,
              planId: 1,
              usageMonthly: [usageRow({ metaMessages: 400, metaTemplateMessages: 50, templateExtraMessages: 50 })],
            }),
            // A new account's number on the trial in its first month: billed 0, it still costs its messages.
            phone({ id: 9, planId: 9, usageMonthly: [usageRow({ metaMessages: 80 })] }),
            // Connected but never in service: nothing to close.
            phone({ id: 10 }),
          ],
        },
      ]),
    },
    messagePlan: { findMany: jest.fn().mockResolvedValue(plans) },
    usageMonthly: {
      groupBy: jest.fn().mockResolvedValue([
        { phoneNumberId: 8, _min: { period: '2026-09' } },
        { phoneNumberId: 9, _min: { period: '2026-10' } },
      ]),
    },
    usageEvent: {
      // The trial number went live on 1 October: its first month is whole.
      groupBy: jest
        .fn()
        .mockResolvedValue([{ phoneNumberId: 9, _min: { deliveredAt: new Date('2026-10-01T15:00:00Z') } }]),
    },
    monthlyClose: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(args => ({ op: 'create', ...args })),
      update: jest.fn().mockImplementation(args => ({ op: 'update', ...args })),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  const config = { get: (key: string) => settings[key] } as unknown as ConfigService
  const usage = new UsageService(prisma as unknown as PrismaService, config, { sendAlert: jest.fn() } as never)
  const service = new MonthlyCloseService(prisma as unknown as PrismaService, usage, config)
  return { service, prisma }
}

const written = (prisma: ReturnType<typeof setup>['prisma']) =>
  prisma.monthlyClose.create.mock.calls.map(([args]: [{ data: Record<string, unknown> }]) => args.data)

describe('the monthly close', () => {
  it('freezes the month of every number in service: plan, messages, billed and the settlement', async () => {
    const { service, prisma } = setup()
    const result = await service.close('2026-10', { now: firstOfNovember })
    expect(result).toEqual({
      period: '2026-10',
      alreadyClosed: false,
      closedNumbers: 2,
      backfilled: false,
      closedAt: firstOfNovember,
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const [onPlan, trial] = written(prisma)
    expect(onPlan).toMatchObject({
      period: '2026-10',
      phoneNumberId: 8,
      producerId: 1,
      producerCodeId: 7,
      planId: 1,
      planName: 'Inicial',
      planMessages: 500,
      planPriceUsd: 25,
      trial: false,
      inService: true,
      firstMonth: false,
      messages: 400,
      templateMessages: 50,
      consumedMessages: 450,
      billedUsd: 25,
      // 450 consumed × USD 0.04 = 18; 25 − 18 = 7, half each.
      costPerMessageUsd: 0.04,
      serviceCostUsd: 18,
      remainderUsd: 7,
      partnerShare: 0.5,
      partnerShareUsd: 3.5,
      ownerShareUsd: 3.5,
      backfilled: false,
      closedAt: firstOfNovember,
      deletedAt: null,
    })
    expect(trial).toMatchObject({
      phoneNumberId: 9,
      planName: 'Prueba',
      trial: true,
      firstMonth: true,
      consumedMessages: 80,
      billedUsd: 0,
      // The trial bills nothing: its cost comes out of the split.
      serviceCostUsd: 3.2,
      remainderUsd: -3.2,
      partnerShareUsd: -1.6,
      ownerShareUsd: -1.6,
    })
  })

  it('freezes the rates of the day it closes', async () => {
    const { service, prisma } = setup({ PARTNER_COST_PER_MESSAGE_USD: '0.03', PARTNER_PROFIT_SHARE: '0.4' })
    await service.close('2026-10', { now: firstOfNovember })
    // 450 × 0.03 = 13.5; 25 − 13.5 = 11.5; 40% = 4.6 for the partner.
    expect(written(prisma)[0]).toMatchObject({
      costPerMessageUsd: 0.03,
      serviceCostUsd: 13.5,
      remainderUsd: 11.5,
      partnerShare: 0.4,
      partnerShareUsd: 4.6,
      ownerShareUsd: 6.9,
    })
  })

  it('never writes a closed month again, unless forced', async () => {
    const { service, prisma } = setup()
    prisma.monthlyClose.findMany.mockResolvedValue([{ id: 31, phoneNumberId: 8, deletedAt: null }])
    await expect(service.close('2026-10', { now: firstOfNovember })).resolves.toMatchObject({
      alreadyClosed: true,
      closedNumbers: 0,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    await expect(service.closeFromOwner('2026-10')).rejects.toThrow(ConflictException)
  })

  it('rewrites a month when forced, and retires the rows of numbers that no longer qualify', async () => {
    const { service, prisma } = setup()
    prisma.monthlyClose.findMany.mockResolvedValue([
      { id: 31, phoneNumberId: 8, deletedAt: null },
      { id: 32, phoneNumberId: 44, deletedAt: null },
    ])
    const result = await service.close('2026-10', { force: true, now: new Date('2026-11-05T15:00:00Z') })
    expect(result).toMatchObject({ closedNumbers: 2, backfilled: true })
    const updates = prisma.monthlyClose.update.mock.calls.map(([args]) => args)
    expect(updates[0]).toMatchObject({
      where: { id: 31 },
      data: { phoneNumberId: 8, backfilled: true, deletedAt: null },
    })
    expect(updates[1]).toEqual({ where: { id: 32 }, data: { deletedAt: new Date('2026-11-05T15:00:00Z') } })
    expect(written(prisma).map(row => row.phoneNumberId)).toEqual([9])
  })

  it('marks as backfilled a month closed after the 1st of the next one', () => {
    expect(isBackfill('2026-10', new Date('2026-11-01T03:00:00Z'))).toBe(false)
    expect(isBackfill('2026-10', new Date('2026-11-02T02:59:00Z'))).toBe(false)
    expect(isBackfill('2026-10', new Date('2026-11-02T03:00:00Z'))).toBe(true)
    expect(isBackfill('2026-09', new Date('2026-11-01T12:00:00Z'))).toBe(true)
  })

  it('only closes a month that already ended', async () => {
    const { service } = setup()
    await expect(service.close('2026-11', { now: firstOfNovember })).rejects.toThrow(BadRequestException)
    await expect(service.close('2026-12', { now: firstOfNovember })).rejects.toThrow(BadRequestException)
    await expect(service.close('2026-13', { now: firstOfNovember })).rejects.toThrow(BadRequestException)
  })

  it('closes the previous month on the 1st, and stays off when MONTHLY_CLOSE_ENABLED is false', async () => {
    const { service, prisma } = setup()
    await expect(service.closePreviousMonth(firstOfNovember)).resolves.toMatchObject({ period: '2026-10' })
    expect(previousPeriod('2026-01')).toBe('2025-12')

    const off = setup({ MONTHLY_CLOSE_ENABLED: 'false' })
    await off.service.scheduledClose()
    off.service.onApplicationBootstrap()
    expect(off.prisma.monthlyClose.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('reads a closed month from its rows and computes only the months not closed', async () => {
    const { service, prisma } = setup()
    prisma.monthlyClose.findMany.mockResolvedValueOnce([
      {
        period: '2026-09',
        phoneNumberId: 8,
        producerId: 1,
        producerCodeId: 7,
        number: '+54 9 341 000-0000',
        isActive: true,
        inService: true,
        firstMonth: true,
        planId: 1,
        planName: 'Inicial',
        planMessages: 500,
        planPriceUsd: 25,
        planExtraBlocks: 0,
        trial: false,
        upgraded: false,
        prorated: true,
        messages: 100,
        templateMessages: 0,
        consumedMessages: 100,
        metaBillableMessages: 0,
        metaCostUsd: 0,
        openaiCostUsd: 0,
        billedUsd: 12.5,
        costPerMessageUsd: 0.04,
        serviceCostUsd: 4,
        remainderUsd: 8.5,
        partnerShare: 0.5,
        partnerShareUsd: 4.25,
        ownerShareUsd: 4.25,
        backfilled: false,
        closedAt: new Date('2026-10-01T03:00:00Z'),
        producerCode: { code: '11425', holderName: null },
      },
    ])
    prisma.producer.findMany.mockResolvedValueOnce([{ id: 1, name: 'Organización', isActive: true, deletedAt: null }])
    const [september, october] = await service.monthSnapshots(['2026-09', '2026-10'])
    expect(september).toMatchObject({ closed: true, backfilled: false })
    expect(september.numbers[0]).toMatchObject({
      billedUsd: 12.5,
      prorated: true,
      settlement: { serviceCostUsd: 4, remainderUsd: 8.5, partnerShareUsd: 4.25 },
    })
    expect(october).toMatchObject({ closed: false })
    expect(october.numbers.map(n => n.phoneNumberId)).toEqual([8, 9, 10])
  })
})
