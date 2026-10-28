import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'

/** ScopeService stand-in: the codes the caller may use. */
const scopeOf = (codes: number[]) => ({
  resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue(codes),
  canAccessCode: jest.fn((_user: unknown, id: number) => Promise.resolve(codes.includes(id))),
})

const superAdmin = (producerId: number) => ({ id: 2, producerId, role: Role.SUPERADMIN })
const admin = { id: 4, producerId: 1, role: Role.ADMIN }

describe('WhatsappOnboardingService', () => {
  it('rejects a standard Cloud API result requested as Coexistence before persisting it', async () => {
    const prisma = {
      phoneNumber: { findUnique: jest.fn() },
      wabaAccount: { upsert: jest.fn() },
    }
    const config = { get: jest.fn(), getOrThrow: jest.fn() }
    const http = { get: jest.fn(), post: jest.fn() }
    const service = new WhatsappOnboardingService(prisma as any, config as any, http as any, scopeOf([]) as any)

    jest.spyOn(service as any, 'exchangeCode').mockResolvedValue({ accessToken: 'token', expiresAt: null })
    jest.spyOn(service as any, 'resolvePhoneNumberId').mockResolvedValue('PHONE-1')
    jest.spyOn(service as any, 'waitForCoexistenceConfirmation').mockResolvedValue({
      metaPhoneNumberId: 'PHONE-1',
      verified: false,
      isOnBizApp: false,
      platformType: 'CLOUD_API',
    })
    const subscribe = jest.spyOn(service as any, 'subscribeApp')

    await expect(
      service.onboard(superAdmin(7), {
        code: 'exchangeable-code',
        wabaId: 'WABA-1',
        phoneNumberId: 'PHONE-1',
        isCoexistence: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(subscribe).not.toHaveBeenCalled()
    expect(prisma.phoneNumber.findUnique).not.toHaveBeenCalled()
    expect(prisma.wabaAccount.upsert).not.toHaveBeenCalled()
  })

  describe('reconnecting a number after Meta dropped it', () => {
    const OLD_ROW = {
      id: 8,
      phoneNumberId: 'OLD-ID',
      producerId: 1,
      deletedAt: null as Date | null,
      responsibleProducerCodeId: 11 as number | null,
    }

    function setup(options: { sameId?: unknown; rows?: unknown[]; codes?: number[] } = {}) {
      const prisma = {
        phoneNumber: {
          findUnique: jest.fn().mockResolvedValue(options.sameId ?? null),
          findMany: jest.fn().mockResolvedValue(options.rows ?? []),
          update: jest.fn().mockResolvedValue({ id: 8 }),
          create: jest.fn().mockResolvedValue({ id: 9 }),
        },
        wabaAccount: { upsert: jest.fn().mockResolvedValue({ id: 5 }) },
        conversation: { updateMany: jest.fn().mockResolvedValue({ count: 40 }) },
        phoneNumberProducerCode: { createMany: jest.fn() },
        $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      }
      const config = { get: jest.fn().mockReturnValue('a'.repeat(64)), getOrThrow: jest.fn() }
      const service = new WhatsappOnboardingService(
        prisma as any,
        config as any,
        { get: jest.fn(), post: jest.fn() } as any,
        scopeOf(options.codes ?? [11, 14]) as any,
      )

      const exchange = jest
        .spyOn(service as any, 'exchangeCode')
        .mockResolvedValue({ accessToken: 'token', expiresAt: null })
      jest.spyOn(service as any, 'resolvePhoneNumberId').mockResolvedValue('NEW-ID')
      jest.spyOn(service as any, 'waitForCoexistenceConfirmation').mockResolvedValue({
        metaPhoneNumberId: 'NEW-ID',
        displayPhoneNumber: '+54 9 341 242-9786',
        verified: true,
        isOnBizApp: true,
        platformType: 'CLOUD_API',
      })
      const subscribe = jest.spyOn(service as any, 'subscribeApp').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'requestAppDataSync').mockResolvedValue(true)
      return { service, prisma, subscribe, exchange }
    }

    const dto = { code: 'exchangeable-code', wabaId: 'WABA-1', isCoexistence: true }

    it('reconnects a number still listed in the panel instead of answering 409, keeping its billing code', async () => {
      const { service, prisma } = setup({ sameId: { ...OLD_ROW, phoneNumberId: 'NEW-ID' } })

      const result = await service.onboard(superAdmin(1), dto)

      expect(result).toEqual(expect.objectContaining({ phoneNumberId: 8, reconnected: true }))
      expect(prisma.phoneNumber.create).not.toHaveBeenCalled()
      const update = prisma.phoneNumber.update.mock.calls[0][0]
      expect(update.where).toEqual({ id: 8 })
      expect(update.data).toEqual(
        expect.objectContaining({ isActive: true, deletedAt: null, wabaAccountId: 5, number: '+54 9 341 242-9786' }),
      )
      expect(update.data).not.toHaveProperty('responsibleProducerCodeId')
      expect(prisma.conversation.updateMany).not.toHaveBeenCalled()
    })

    it('refuses a number that is live in another organization', async () => {
      const { service, subscribe } = setup({ sameId: { ...OLD_ROW, phoneNumberId: 'NEW-ID', producerId: 2 } })

      await expect(service.onboard(superAdmin(1), dto)).rejects.toBeInstanceOf(ConflictException)
      expect(subscribe).not.toHaveBeenCalled()
    })

    it('reuses the previous row and moves its chats when Meta hands out a new phone_number_id', async () => {
      const { service, prisma } = setup({
        rows: [
          {
            ...OLD_ROW,
            number: 'OLD-ID',
            deletedAt: new Date('2026-10-19T19:59:56.000Z'),
            wabaAccount: { wabaId: 'WABA-1', disconnectedAt: null },
          },
        ],
      })

      await expect(service.onboard(superAdmin(1), dto)).resolves.toEqual(
        expect.objectContaining({ phoneNumberId: 8, reconnected: true, metaPhoneNumberId: 'NEW-ID' }),
      )
      expect(prisma.phoneNumber.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 }, data: expect.objectContaining({ phoneNumberId: 'NEW-ID' }) }),
      )
      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { phoneNumberId: 'OLD-ID' },
        data: { phoneNumberId: 'NEW-ID' },
      })
      expect(prisma.phoneNumber.create).not.toHaveBeenCalled()
    })

    it('finds the previous row by display number when the WABA changed too', async () => {
      const { service, prisma } = setup({
        rows: [
          {
            ...OLD_ROW,
            number: '+5493412429786',
            deletedAt: null,
            wabaAccount: { wabaId: 'OLD-WABA', disconnectedAt: new Date() },
          },
        ],
      })

      await service.onboard(superAdmin(1), dto)

      expect(prisma.phoneNumber.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8 } }))
      expect(prisma.phoneNumber.create).not.toHaveBeenCalled()
    })

    it('never takes over another number that is still connected', async () => {
      const { service, prisma } = setup({
        rows: [{ ...OLD_ROW, number: 'OLD-ID', wabaAccount: { wabaId: 'WABA-1', disconnectedAt: null } }],
      })

      await expect(service.onboard(superAdmin(1), dto)).resolves.toEqual(
        expect.objectContaining({ phoneNumberId: 9, reconnected: false }),
      )
      expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
      expect(prisma.conversation.updateMany).not.toHaveBeenCalled()
    })
  })

  describe("an admin connecting their office's numbers", () => {
    function setup(options: { sameId?: unknown; codes?: number[] } = {}) {
      const prisma = {
        phoneNumber: {
          findUnique: jest.fn().mockResolvedValue(options.sameId ?? null),
          findFirst: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({ id: 8 }),
          create: jest.fn().mockResolvedValue({ id: 9 }),
        },
        wabaAccount: { upsert: jest.fn().mockResolvedValue({ id: 5 }) },
        phoneNumberProducerCode: { createMany: jest.fn() },
      }
      const config = { get: jest.fn().mockReturnValue('a'.repeat(64)), getOrThrow: jest.fn() }
      const service = new WhatsappOnboardingService(
        prisma as any,
        config as any,
        { get: jest.fn(), post: jest.fn() } as any,
        scopeOf(options.codes ?? [14]) as any,
      )
      const exchange = jest
        .spyOn(service as any, 'exchangeCode')
        .mockResolvedValue({ accessToken: 'token', expiresAt: null })
      jest.spyOn(service as any, 'resolvePhoneNumberId').mockResolvedValue('PHONE-1')
      jest.spyOn(service as any, 'waitForCoexistenceConfirmation').mockResolvedValue({
        metaPhoneNumberId: 'PHONE-1',
        displayPhoneNumber: '+54 9 3492 55-0000',
        verified: true,
        isOnBizApp: true,
        platformType: 'CLOUD_API',
      })
      const subscribe = jest.spyOn(service as any, 'subscribeApp').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'requestAppDataSync').mockResolvedValue(true)
      return { service, prisma, subscribe, exchange }
    }

    const dto = { code: 'exchangeable-code', wabaId: 'WABA-2', isCoexistence: true }

    it("bills a new number to the admin's only code when the panel sends none", async () => {
      const { service, prisma } = setup()

      await expect(service.onboard(admin, dto)).resolves.toMatchObject({ phoneNumberId: 9, reconnected: false })
      expect(prisma.phoneNumber.create.mock.calls[0][0].data).toMatchObject({
        producerId: 1,
        responsibleProducerCodeId: 14,
      })
    })

    it("refuses a code that is not theirs before spending Meta's code", async () => {
      const { service, exchange } = setup()

      await expect(service.onboard(admin, { ...dto, responsibleProducerCodeId: 11 })).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      await expect(service.onboard(admin, { ...dto, servedCodeIds: [11] })).rejects.toBeInstanceOf(ForbiddenException)
      expect(exchange).not.toHaveBeenCalled()
    })

    it('asks an admin with several codes which one the number is billed to', async () => {
      const { service, exchange } = setup({ codes: [14, 15] })

      await expect(service.onboard(admin, dto)).rejects.toBeInstanceOf(BadRequestException)
      expect(exchange).not.toHaveBeenCalled()
      await expect(service.onboard(admin, { ...dto, responsibleProducerCodeId: 15 })).resolves.toMatchObject({
        phoneNumberId: 9,
      })
    })

    it("never reconnects another office's number", async () => {
      const { service, prisma, subscribe } = setup({
        sameId: { id: 8, phoneNumberId: 'PHONE-1', producerId: 1, deletedAt: null, responsibleProducerCodeId: 11 },
      })

      await expect(service.onboard(admin, dto)).rejects.toBeInstanceOf(ForbiddenException)
      expect(subscribe).not.toHaveBeenCalled()
      expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
    })

    it('reconnects their own number', async () => {
      const { service } = setup({
        sameId: { id: 8, phoneNumberId: 'PHONE-1', producerId: 1, deletedAt: null, responsibleProducerCodeId: 14 },
      })

      await expect(service.onboard(admin, dto)).resolves.toMatchObject({ phoneNumberId: 8, reconnected: true })
    })

    it("does not show the connection status of another office's number", async () => {
      const { service, prisma } = setup()
      prisma.phoneNumber.findFirst.mockResolvedValue({ responsibleProducerCodeId: 11 })

      await expect(service.getConnectionStatus(admin, 'PHONE-1')).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.retryAppDataSync(admin, 'PHONE-1')).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phoneNumberId: 'PHONE-1', producerId: 1, deletedAt: null } }),
      )
    })
  })
})
