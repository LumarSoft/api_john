import { BadGatewayException, BadRequestException, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import type { TriunfoService } from './triunfo.service'
import { TriunfoCredentialsService } from './triunfo-credentials.service'

const KEY_HEX = 'b'.repeat(64)
const DTO = { productor: ' 20001 ', username: ' OTRAORG ', password: 'clave' }

function setup(stored: Record<string, unknown> | null = null, slug = 'otra-org') {
  const prisma = {
    producer: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve({ slug, triunfoCredential: stored })),
    },
    triunfoCredential: {
      upsert: jest.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
        stored = { ...create, deletedAt: null }
        return Promise.resolve(stored)
      }),
      updateMany: jest.fn().mockImplementation(() => {
        stored = stored ? { ...stored, deletedAt: new Date() } : null
        return Promise.resolve({ count: 1 })
      }),
    },
  }
  const triunfo = {
    verifyCredentials: jest.fn().mockResolvedValue(undefined),
    forgetCredentials: jest.fn(),
    hasEnvCredentialsFor: jest.fn((s: string) => s === 'john'),
  }
  const config = { get: () => KEY_HEX } as unknown as ConfigService
  const service = new TriunfoCredentialsService(
    prisma as unknown as PrismaService,
    triunfo as unknown as TriunfoService,
    config,
  )
  return { service, prisma, triunfo }
}

describe('TriunfoCredentialsService', () => {
  it('saves the credentials encrypted once Triunfo accepts them', async () => {
    const { service, prisma, triunfo } = setup()

    const status = await service.save(2, DTO)

    expect(triunfo.verifyCredentials).toHaveBeenCalledWith({
      productor: '20001',
      usuario: 'OTRAORG',
      password: 'clave',
    })
    const { create } = prisma.triunfoCredential.upsert.mock.calls[0][0] as { create: { password: string } }
    expect(create).toMatchObject({ producerId: 2, productor: '20001', username: 'OTRAORG' })
    expect(create.password).not.toContain('clave')
    expect(decryptSecret(create.password, resolveKey(KEY_HEX, 'K'))).toBe('clave')
    expect(triunfo.forgetCredentials).toHaveBeenCalledWith(2)
    expect(status).toMatchObject({ configured: true, productor: '20001', username: 'OTRAORG' })
    expect(status).not.toHaveProperty('password')
  })

  it('saves nothing when Triunfo refuses the credentials', async () => {
    const { service, prisma, triunfo } = setup()
    triunfo.verifyCredentials.mockRejectedValue(new UnauthorizedException('No se pudo obtener token de Triunfo'))

    await expect(service.save(2, DTO)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.triunfoCredential.upsert).not.toHaveBeenCalled()
  })

  it('saves nothing when Triunfo cannot be reached', async () => {
    const { service, prisma, triunfo } = setup()
    triunfo.verifyCredentials.mockRejectedValue(new Error('socket hang up'))

    await expect(service.save(2, DTO)).rejects.toBeInstanceOf(BadGatewayException)
    expect(prisma.triunfoCredential.upsert).not.toHaveBeenCalled()
  })

  it('tells the default organization apart, which keeps working on the settings', async () => {
    await expect(setup(null, 'john').service.status(1)).resolves.toEqual({
      configured: false,
      productor: null,
      username: null,
      verifiedAt: null,
      usesDefaultSettings: true,
    })
    await expect(setup(null).service.status(2)).resolves.toMatchObject({ usesDefaultSettings: false })
  })

  it('removes them with a soft delete', async () => {
    const { service, prisma, triunfo } = setup({
      productor: '20001',
      username: 'OTRAORG',
      verifiedAt: new Date(),
      deletedAt: null,
    })

    await expect(service.remove(2)).resolves.toMatchObject({ configured: false })
    expect(prisma.triunfoCredential.updateMany).toHaveBeenCalledWith({
      where: { producerId: 2, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(triunfo.forgetCredentials).toHaveBeenCalledWith(2)
  })
})
