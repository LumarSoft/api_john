import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { BusinessHoursService } from './business-hours.service'

describe('BusinessHoursService per WhatsApp number', () => {
  function setup(phone: { producerId: number } | null) {
    const prisma = {
      phoneNumber: { findFirst: jest.fn().mockResolvedValue(phone) },
      producer: { findFirst: jest.fn().mockResolvedValue({ businessHours: null }) },
      businessClosure: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new BusinessHoursService(prisma as unknown as PrismaService, {} as ConfigService)
    return { service, prisma }
  }

  it("answers with the hours of the number's organization", async () => {
    const { service, prisma } = setup({ producerId: 2 })

    await service.getStatusForNumber('555')

    expect(prisma.producer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2, deletedAt: null } }),
    )
    expect(prisma.businessClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ producerId: 2 }) }),
    )
  })

  it('refuses a number that is not registered', async () => {
    await expect(setup(null).service.getStatusForNumber('999')).rejects.toMatchObject({ status: 404 })
  })
})
