import { Role } from 'generated/prisma/client'
import { PhoneNumbersService } from './phone-numbers.service'
import { UsageService } from '../usage/usage.service'

describe('monthly phone number report', () => {
  function setup() {
    const prisma = {
      phoneNumber: {
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
    }
    const usage = { priceFor: UsageService.prototype.priceFor }
    return { prisma, service: new PhoneNumbersService(prisma as any, usage as any) }
  }

  it('selects one month within the organization and shows the full monthly charge and activity', async () => {
    const { service, prisma } = setup()
    const rows = await service.list(2, Role.SUPERADMIN, '2026-09')
    expect(prisma.phoneNumber.findMany.mock.calls[0][0]).toMatchObject({
      where: { producerId: 2, deletedAt: null },
      select: { usageMonthly: { where: { period: '2026-09' } } },
    })
    expect(rows[0].usage).toMatchObject({
      period: '2026-09',
      billedUsd: 15.63,
      openaiCalls: 80,
      metaMessages: 1200,
      metaBillableMessages: 200,
    })
    expect(rows[0].usage).not.toHaveProperty('totalCostUsd')
    expect(rows[0].usage).not.toHaveProperty('marginUsd')
  })

  it('exposes provider cost and profit only to the owner', async () => {
    const { service } = setup()
    expect((await service.list(2, Role.OWNER, '2026-09'))[0].usage).toMatchObject({
      totalCostUsd: 5.21,
      marginUsd: 10.42,
    })
  })

  it('rejects invalid and future month selectors', async () => {
    const { service, prisma } = setup()
    await expect(service.list(2, Role.OWNER, '2026-13')).rejects.toThrow('Mes inválido')
    await expect(service.list(2, Role.OWNER, '2099-01')).rejects.toThrow('Mes inválido')
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })
})
