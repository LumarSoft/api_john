import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { BusinessHoursService } from './business-hours.service'

describe('BusinessHoursService per WhatsApp number', () => {
  const closedAllWeek = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

  function setup(phone: { producerId: number; businessHours?: unknown; organizationHours?: unknown } | null) {
    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue(
          phone && {
            producerId: phone.producerId,
            businessHours: phone.businessHours ?? null,
            producer: { businessHours: phone.organizationHours ?? null },
          },
        ),
      },
      businessClosure: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new BusinessHoursService(prisma as unknown as PrismaService, {} as ConfigService)
    return { service, prisma }
  }

  it("answers with the hours of the number's organization", async () => {
    const { service, prisma } = setup({ producerId: 2, organizationHours: closedAllWeek })

    await expect(service.getStatusForNumber('555')).resolves.toMatchObject({ isOpenNow: false })
    expect(prisma.businessClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ producerId: 2 }) }),
    )
  })

  it("answers with the number's own hours when it has them", async () => {
    const { service } = setup({ producerId: 2, businessHours: closedAllWeek, organizationHours: null })

    const status = await service.getStatusForNumber('555')

    expect(status.isOpenNow).toBe(false)
  })

  it('refuses a number that is not registered', async () => {
    await expect(setup(null).service.getStatusForNumber('999')).rejects.toMatchObject({ status: 404 })
  })
})
