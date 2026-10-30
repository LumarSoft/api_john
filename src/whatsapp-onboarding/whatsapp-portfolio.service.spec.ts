import { of, throwError } from 'rxjs'
import { encryptSecret } from '../common/crypto/secret-crypto'
import { WhatsappPortfolioService } from './whatsapp-portfolio.service'

const KEY = '0'.repeat(64)

function setup(enabled = true) {
  const prisma = {
    wabaAccount: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 6, wabaId: '1738044257427062', accessToken: encryptSecret('token', Buffer.from(KEY, 'hex')) },
        ]),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const config = {
    get: (name: string) =>
      ({ WABA_TOKEN_ENCRYPTION_KEY: KEY, WHATSAPP_CONNECTION_CHECK_ENABLED: enabled ? undefined : 'false' })[name],
  }
  const http = {
    get: jest.fn().mockReturnValue(
      of({
        data: {
          name: 'John Pellegrini Management Group',
          business_verification_status: 'not_verified',
          owner_business_info: { id: '1754170539213714', name: 'JPMG - Oficina rosario' },
        },
      }),
    ),
  }
  const service = new WhatsappPortfolioService(prisma as never, config as never, http as never)
  return { service, prisma, http }
}

describe('the Meta portfolio of each WhatsApp account', () => {
  it('reads the account, its owner portfolio and its verification, and stores them', async () => {
    const { service, prisma, http } = setup()
    await expect(service.refreshDaily()).resolves.toBe(1)
    expect(http.get.mock.calls[0][0]).toMatch(/\/1738044257427062$/)
    expect(http.get.mock.calls[0][1]).toMatchObject({
      params: { fields: 'name,owner_business_info,business_verification_status' },
      headers: { Authorization: 'Bearer token' },
    })
    expect(prisma.wabaAccount.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: {
        wabaName: 'John Pellegrini Management Group',
        businessId: '1754170539213714',
        businessName: 'JPMG - Oficina rosario',
        businessVerification: 'not_verified',
        portfolioCheckedAt: expect.any(Date),
      },
    })
  })

  it('keeps what it had when Meta does not answer, and never calls Meta when the checks are off', async () => {
    const failing = setup()
    failing.http.get.mockReturnValue(
      throwError(() => ({ response: { data: { error: { message: 'Unsupported get' } } } })),
    )
    await expect(failing.service.refreshDaily()).resolves.toBe(0)
    expect(failing.prisma.wabaAccount.update).not.toHaveBeenCalled()

    const off = setup(false)
    await expect(off.service.refreshDaily()).resolves.toBe(0)
    off.service.onApplicationBootstrap()
    expect(off.http.get).not.toHaveBeenCalled()
  })
})
