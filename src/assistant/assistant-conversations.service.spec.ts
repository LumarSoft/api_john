import { NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { ScopeService } from '../common/scope/scope.service'
import type { AssistantActionsService } from './assistant-actions.service'
import { AssistantConversationsService, fitsScope } from './assistant-conversations.service'

const nico = { id: 4, producerId: 1, role: Role.ADMIN }
const mili = { id: 2, producerId: 1, role: Role.SUPERADMIN }

function setup(rows: Array<{ id: number; scopeKey: string | null }>, codes: number[] = [14]) {
  const prisma = {
    assistantConversation: {
      findMany: jest.fn().mockResolvedValue(rows.map(r => ({ ...r, title: `conv ${r.id}`, updatedAt: new Date() }))),
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) => {
        const row = rows.find(r => r.id === where.id)
        return row ? { ...row, title: `conv ${row.id}` } : null
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 1,
        ...data,
        updatedAt: new Date(),
      })),
    },
  }
  const scope = { resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue(codes) }
  const service = new AssistantConversationsService(
    prisma as unknown as PrismaService,
    {} as AssistantActionsService,
    scope as unknown as ScopeService,
  )
  return { service, prisma }
}

describe('fitsScope', () => {
  it('keeps a conversation while the person keeps every code and the role they had', () => {
    expect(fitsScope('ADMIN:3,14', 'ADMIN:3,14')).toBe(true)
    expect(fitsScope('ADMIN:14', 'ADMIN:3,14')).toBe(true)
    expect(fitsScope('SUPERADMIN', 'SUPERADMIN')).toBe(true)
    expect(fitsScope(null, 'ADMIN:')).toBe(true)
  })

  it('closes it once they lose a code or change role', () => {
    expect(fitsScope('ADMIN:3,14', 'ADMIN:14')).toBe(false)
    expect(fitsScope('ADMIN:3', 'ADMIN:')).toBe(false)
    expect(fitsScope('SUPERADMIN', 'ADMIN:3,14')).toBe(false)
    expect(fitsScope('ADMIN:3', 'SUPERADMIN')).toBe(false)
  })
})

describe('AssistantConversationsService', () => {
  it("stores who the person was: an admin's codes, a superadmin's role", async () => {
    const admin = setup([], [14, 3])
    await admin.service.create(nico, 'Hola')
    expect(admin.prisma.assistantConversation.create.mock.calls[0][0].data.scopeKey).toBe('ADMIN:3,14')

    const superAdmin = setup([])
    await superAdmin.service.create(mili, 'Hola')
    expect(superAdmin.prisma.assistantConversation.create.mock.calls[0][0].data.scopeKey).toBe('SUPERADMIN')
  })

  it('no longer lists nor opens a conversation from codes the admin lost', async () => {
    const { service } = setup(
      [
        { id: 1, scopeKey: 'ADMIN:14' },
        { id: 2, scopeKey: 'ADMIN:3,14' },
        { id: 3, scopeKey: null },
      ],
      [14],
    )
    expect((await service.list(nico)).map(c => c.id)).toEqual([1, 3])
    await expect(service.findOwn(nico, 2)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.findOwn(nico, 1)).resolves.toEqual({ id: 1, title: 'conv 1' })
  })
})
