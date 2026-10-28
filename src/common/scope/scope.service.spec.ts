import { Role } from 'generated/prisma/client'
import { ScopeService, numberWhere } from './scope.service'

describe('ScopeService.resolveChatScope', () => {
  function setup() {
    const prisma = {
      producerCode: { findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 4 }]) },
      userProducerCode: { findMany: jest.fn().mockResolvedValue([{ producerCodeId: 4 }]) },
      phoneNumber: {
        findMany: jest.fn().mockResolvedValue([{ phoneNumberId: 'BRANCH' }]),
        // The office line (default number) and, by id, the number of a section filter.
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { id?: number } }) =>
            Promise.resolve(
              where.id === undefined
                ? { id: 8, phoneNumberId: 'OFFICE', number: '+54 9 341 000-0000' }
                : where.id === 11
                  ? { phoneNumberId: 'BRANCH' }
                  : null,
            ),
          ),
      },
    }
    return { prisma, scope: new ScopeService(prisma as never) }
  }

  it('limits an admin to the chats of the numbers billed to their codes', async () => {
    const { prisma, scope } = setup()

    await expect(scope.resolveChatScope({ id: 4, producerId: 1, role: Role.ADMIN })).resolves.toEqual({
      codeIds: [4],
      ownNumbers: ['BRANCH'],
      defaultNumber: 'OFFICE',
      filterNumber: null,
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
      defaultNumber: 'OFFICE',
      filterNumber: null,
    })
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })

  it("resolves the superadmin's number filter to its Meta id, and an unknown number to nothing", async () => {
    const { scope } = setup()
    const user = { id: 2, producerId: 1, role: Role.SUPERADMIN }

    await expect(scope.resolveChatScope(user, [4], 11)).resolves.toMatchObject({ filterNumber: 'BRANCH' })
    await expect(scope.resolveChatScope(user, [4], 99)).resolves.toMatchObject({ filterNumber: '' })
  })
})

describe('numberWhere', () => {
  it('limits an admin to their own numbers, plus what came through none when the office line is theirs', () => {
    expect(numberWhere({ codeIds: [], ownNumbers: ['BRANCH'], defaultNumber: 'OFFICE' })).toEqual({
      phoneNumberId: { in: ['BRANCH'] },
    })
    expect(numberWhere({ codeIds: [], ownNumbers: ['OFFICE', 'BRANCH'], defaultNumber: 'OFFICE' })).toEqual({
      OR: [{ phoneNumberId: { in: ['OFFICE', 'BRANCH'] } }, { phoneNumberId: null }],
    })
  })

  it('lets the superadmin see everything, or the number of their filter', () => {
    expect(numberWhere({ codeIds: [], ownNumbers: null, defaultNumber: 'OFFICE' })).toEqual({})
    expect(numberWhere({ codeIds: [], ownNumbers: null, filterNumber: 'BRANCH', defaultNumber: 'OFFICE' })).toEqual({
      phoneNumberId: { in: ['BRANCH'] },
    })
    expect(numberWhere({ codeIds: [], ownNumbers: null, filterNumber: 'OFFICE', defaultNumber: 'OFFICE' })).toEqual({
      OR: [{ phoneNumberId: { in: ['OFFICE'] } }, { phoneNumberId: null }],
    })
    // A number that is not the organization's: nothing, never everything.
    expect(numberWhere({ codeIds: [], ownNumbers: null, filterNumber: '', defaultNumber: 'OFFICE' })).toEqual({
      phoneNumberId: { in: [] },
    })
  })

  it("never lets an admin filter their way into another branch's number", () => {
    expect(
      numberWhere({ codeIds: [], ownNumbers: ['BRANCH'], filterNumber: 'OTHER', defaultNumber: 'OFFICE' }),
    ).toEqual({
      phoneNumberId: { in: [] },
    })
  })
})
