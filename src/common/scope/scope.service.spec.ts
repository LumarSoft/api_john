import { Role } from 'generated/prisma/client'
import { ScopeService, ScopeUser, numberWhere } from './scope.service'

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

describe('ScopeService.resolveScopedCodeIdsFor by número', () => {
  // As in production: the office line (8, billed to the master code 1) serves
  // every code so its bot can attend anyone; Pueblo Esther (11) is billed to 3
  // and also serves 6 and 7; Funes (12) and Roldán (13) only their own code.
  const phones = [
    { id: 8, responsibleProducerCodeId: 1, servedCodes: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: 11, responsibleProducerCodeId: 3, servedCodes: [3, 6, 7] },
    { id: 12, responsibleProducerCodeId: 4, servedCodes: [] },
    { id: 13, responsibleProducerCodeId: 5, servedCodes: [] },
  ]

  function setup(numbers = phones) {
    const prisma = {
      producerCode: { findMany: jest.fn().mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id }))) },
      userProducerCode: { findMany: jest.fn().mockResolvedValue([{ producerCodeId: 2 }, { producerCodeId: 3 }]) },
      phoneNumber: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            numbers.map(n => ({ ...n, servedCodes: n.servedCodes.map(producerCodeId => ({ producerCodeId })) })),
          ),
        // The organization's default number (the office line).
        findFirst: jest.fn().mockResolvedValue({ id: 8, phoneNumberId: 'OFFICE', number: '+54 9 341 000-0000' }),
      },
    }
    return new ScopeService(prisma as never)
  }

  const superadmin: ScopeUser = { id: 1, producerId: 1, role: Role.SUPERADMIN }
  const codesOf = (phoneNumberId: number, scope = setup(), user = superadmin) =>
    scope.resolveScopedCodeIdsFor(user, { phoneNumberId }).then(ids => [...ids].sort((a, b) => a - b))

  it('leaves out of the office line the codes of the other branches', async () => {
    await expect(codesOf(8)).resolves.toEqual([1, 2, 8])
  })

  it('gives each branch its own code and the ones it also serves', async () => {
    await expect(codesOf(11)).resolves.toEqual([3, 6, 7])
    await expect(codesOf(12)).resolves.toEqual([4])
    await expect(codesOf(13)).resolves.toEqual([5])
  })

  it('keeps on a branch a code another branch also serves, but not one billed to another number', async () => {
    const shared = phones.map(n => (n.id === 12 ? { ...n, servedCodes: [6, 1] } : n))
    await expect(codesOf(12, setup(shared))).resolves.toEqual([4, 6])
  })

  it("sees nothing for a number that is not the organization's", async () => {
    await expect(codesOf(99)).resolves.toEqual([])
  })

  it("stays within an admin's own codes", async () => {
    await expect(codesOf(8, setup(), { id: 2, producerId: 1, role: Role.ADMIN })).resolves.toEqual([2])
  })
})
