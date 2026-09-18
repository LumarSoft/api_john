import { BadRequestException } from '@nestjs/common'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'

describe('WhatsappOnboardingService', () => {
  it('rejects a standard Cloud API result requested as Coexistence before persisting it', async () => {
    const prisma = {
      phoneNumber: { findUnique: jest.fn() },
      wabaAccount: { upsert: jest.fn() },
    }
    const config = { get: jest.fn(), getOrThrow: jest.fn() }
    const http = { get: jest.fn(), post: jest.fn() }
    const service = new WhatsappOnboardingService(prisma as any, config as any, http as any)

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
      service.onboard(7, {
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
})
