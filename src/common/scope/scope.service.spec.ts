import { Role } from 'generated/prisma/client'
import { ScopeService } from './scope.service'

describe('ScopeService.resolveChatScope', () => {
  function setup() {
    const prisma = {
      producerCode: { findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 4 }]) },
      userProducerCode: { findMany: jest.fn().mockResolvedValue([{ producerCodeId: 4 }]) },
      phoneNumber: { findMany: jest.fn().mockResolvedValue([{ phoneNumberId: 'BRANCH' }]) },
    }
    return { prisma, scope: new ScopeService(prisma as never) }
  }

  it('limits an admin to the chats of the numbers billed to their codes', async () => {
    const { prisma, scope } = setup()

    await expect(scope.resolveChatScope({ id: 4, producerId: 1, role: Role.ADMIN })).resolves.toEqual({
      codeIds: [4],
      ownNumbers: ['BRANCH'],
    })
    expect(prisma.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { producerId: 1, deletedAt: null, responsibleProducerCodeId: { in: [4] } },
      select: { phoneNumberId: true },
    })
  })

  it('does not limit the superadmin by number and keeps the codes of its filter', async () => {
    const { prisma, scope } = setup()

    await expect(scope.resolveChatScope({ id: 2, producerId: 1, role: Role.SUPERADMIN }, [4])).resolves.toEqual({
      codeIds: [4],
      ownNumbers: null,
    })
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })
})
