import { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import { PhoneNumbersService } from './phone-numbers.service'
import { UsageService } from '../usage/usage.service'

describe('monthly phone number report', () => {
  function setup() {
    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            number: '+5493416000000',
            phoneNumberId: 'PN',
            isActive: true,
            servedCodes: [],
            responsibleProducerCode: null,
            usageMonthly: [
              {
                openaiCalls: 80,
                metaMessages: 1200,
                metaBillableMessages: 200,
                openaiInputTokens: 10000,
                openaiOutputTokens: 1000,
                totalCostUsd: 5.21,
                openaiCostUsd: 0.01,
                metaCostUsd: 5.2,
              },
            ],
          },
        ]),
      },
      // In service since August, so September is a full month.
      usageMonthly: { groupBy: jest.fn().mockResolvedValue([{ phoneNumberId: 1, _min: { period: '2026-08' } }]) },
      usageEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    }
    const usage = new UsageService(prisma as any, { get: () => undefined } as unknown as ConfigService)
    return { prisma, service: new PhoneNumbersService(prisma as any, usage as any) }
  }

  const ownerOnly = ['pricing', 'plan', 'prorated', 'billedUsd', 'totalCostUsd', 'marginUsd', 'metaBillableMessages']

  it('shows an admin only the tokens of the month, never an amount in USD', async () => {
    const { service, prisma } = setup()
    const [row] = await service.list(2, Role.ADMIN, '2026-09')
    expect(prisma.phoneNumber.findMany.mock.calls[0][0]).toMatchObject({
      where: { producerId: 2, deletedAt: null },
      select: { usageMonthly: { where: { period: '2026-09' } } },
    })
    expect(row.usage).toEqual({ period: '2026-09', tokens: 1200 })
    expect(row).not.toHaveProperty('monthlyBudgetUsd')
    expect(row).not.toHaveProperty('budgetExceededAt')
  })

  it('shows a superadmin the messages and the OpenAI calls and tokens, without plan or USD', async () => {
    const { service } = setup()
    const [row] = await service.list(2, Role.SUPERADMIN, '2026-09')
    expect(row.usage).toMatchObject({
      tokens: 1200,
      metaMessages: 1200,
      openaiCalls: 80,
      inputTokens: 10000,
      outputTokens: 1000,
    })
    for (const field of ownerOnly) expect(row.usage).not.toHaveProperty(field)
    expect(row).not.toHaveProperty('monthlyBudgetUsd')
    expect(row).toHaveProperty('budgetExceededAt')
  })

  it('shows the owner the plan it bills, its price, the provider cost and the profit', async () => {
    const { service } = setup()
    const [row] = await service.list(2, Role.OWNER, '2026-09')
    expect(row.usage).toMatchObject({
      tokens: 1200,
      openaiCalls: 80,
      pricing: { blockTokens: 1000, blockPriceUsd: 60 },
      plan: { name: 'Estándar', includedTokens: 2000, priceUsd: 120 },
      billedUsd: 120,
      totalCostUsd: 5.21,
      marginUsd: 114.79,
      metaBillableMessages: 200,
    })
    expect(row).toHaveProperty('monthlyBudgetUsd')
  })

  it('lets only the owner set the AI budget of a number', async () => {
    const { service, prisma } = setup()
    await service.update(1, 2, { number: '+5493416000001', monthlyBudgetUsd: 500 }, Role.SUPERADMIN)
    expect(prisma.phoneNumber.update.mock.calls[0][0].data).toEqual({ number: '+5493416000001' })
    await service.update(1, 2, { monthlyBudgetUsd: 30 }, Role.OWNER)
    expect(prisma.phoneNumber.update.mock.calls[1][0].data).toEqual({ monthlyBudgetUsd: 30 })
  })

  it('rejects invalid and future month selectors', async () => {
    const { service, prisma } = setup()
    await expect(service.list(2, Role.OWNER, '2026-13')).rejects.toThrow('Mes inválido')
    await expect(service.list(2, Role.OWNER, '2099-01')).rejects.toThrow('Mes inválido')
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })
})
