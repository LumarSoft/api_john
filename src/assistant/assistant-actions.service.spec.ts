import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { AssistantActionStatus, Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { ScopeService } from '../common/scope/scope.service'
import { AssistantActionsService } from './assistant-actions.service'
import type { ActionExecutor, ToolContext } from './tools/tool.types'

const now = new Date('2026-11-06T15:00:00Z')
const mili = { id: 2, producerId: 7, role: Role.ADMIN }
const preview = {
  title: 'Cambiar la cuenta',
  target: 'Toda la organización',
  changes: [],
  notes: [],
  confirmLabel: 'Cambiar',
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    type: 'datos_de_pago',
    status: AssistantActionStatus.PENDING,
    payload: {
      scope: 'organization',
      changes: { transferAlias: 'a' },
      undo: { scope: 'organization', changes: { transferAlias: 'viejo' } },
    } as Record<string, unknown>,
    preview,
    result: null,
    error: null,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  }
}

function setup(found: ReturnType<typeof row> | null = row()) {
  const prisma = {
    assistantAction: {
      create: jest.fn().mockResolvedValue(row()),
      findFirst: jest.fn().mockResolvedValue(found),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ conversationId: 4 }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => row({ ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    assistantConversation: { update: jest.fn() },
  }
  const scope = { resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue([3]) }
  const executor: ActionExecutor = {
    type: 'datos_de_pago',
    execute: jest.fn().mockResolvedValue({ summary: 'Listo.', refresh: ['config'] }),
  }
  const service = new AssistantActionsService(prisma as unknown as PrismaService, scope as unknown as ScopeService)
  service.register([executor])
  return { service, prisma, executor }
}

describe('AssistantActionsService', () => {
  it('stores a proposal for the conversation and adds its card to the turn', async () => {
    const { service, prisma } = setup()
    const ctx: ToolContext = { user: mili, codeIds: [3], conversationId: 4, now, proposed: [] }
    const view = await service.propose(ctx, 'datos_de_pago', { scope: 'organization' }, preview)

    expect(prisma.assistantAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conversationId: 4, userId: 2, producerId: 7, type: 'datos_de_pago' }),
      }),
    )
    expect(ctx.proposed).toEqual([view])
    expect(view.status).toBe('pending')
  })

  it('cannot propose outside a saved conversation', async () => {
    const { service } = setup()
    const ctx: ToolContext = { user: mili, codeIds: [3], conversationId: null, now, proposed: [] }
    await expect(service.propose(ctx, 'datos_de_pago', {}, preview)).rejects.toBeInstanceOf(ConflictException)
  })

  it('runs a confirmed proposal once, with the confirming user and their codes', async () => {
    const { service, executor, prisma } = setup()
    const result = await service.confirm(mili, 5, now)

    expect(prisma.assistantAction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, userId: 2, producerId: 7 }) }),
    )
    expect(prisma.assistantAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, status: AssistantActionStatus.PENDING }) }),
    )
    expect(executor.execute).toHaveBeenCalledWith(mili, [3], { scope: 'organization', changes: { transferAlias: 'a' } })
    expect(result.refresh).toEqual(['config'])
  })

  it('never runs someone else’s proposal', async () => {
    const { service, executor } = setup(null)
    await expect(service.confirm(mili, 5, now)).rejects.toBeInstanceOf(NotFoundException)
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('refuses one that expired, was cancelled or already ran', async () => {
    for (const found of [
      row({ expiresAt: new Date(now.getTime() - 1) }),
      row({ status: AssistantActionStatus.CANCELLED }),
      row({ status: AssistantActionStatus.CONFIRMED }),
    ]) {
      const { service, executor } = setup(found)
      await expect(service.confirm(mili, 5, now)).rejects.toBeInstanceOf(ConflictException)
      expect(executor.execute).not.toHaveBeenCalled()
    }
  })

  it('a second tap that loses the race does not run it again', async () => {
    const { service, executor, prisma } = setup()
    prisma.assistantAction.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.confirm(mili, 5, now)).rejects.toBeInstanceOf(ConflictException)
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('marks it failed with the service’s message when the change is refused', async () => {
    const { service, executor, prisma } = setup()
    ;(executor.execute as jest.Mock).mockRejectedValueOnce(new BadRequestException('La fecha ya pasó'))
    const result = await service.confirm(mili, 5, now)

    expect(prisma.assistantAction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AssistantActionStatus.FAILED, error: 'La fecha ya pasó' } }),
    )
    expect(result.action.status).toBe('failed')
    expect(result.refresh).toEqual([])
  })

  it('proposes going back with the exact values a confirmed change replaced, and can redo it', async () => {
    const { service, prisma } = setup()
    prisma.assistantAction.findFirst.mockResolvedValueOnce(
      row({
        status: AssistantActionStatus.CONFIRMED,
        preview: { ...preview, changes: [{ label: 'Alias', before: 'viejo', after: 'a' }] },
      }),
    )
    const ctx: ToolContext = { user: mili, codeIds: [3], conversationId: 4, now, proposed: [] }
    await service.proposeUndo(ctx, 5)

    const data = (prisma.assistantAction.create.mock.calls[0] as [{ data: Record<string, any> }])[0].data
    expect(data.payload).toEqual({
      scope: 'organization',
      changes: { transferAlias: 'viejo' },
      undo: { scope: 'organization', changes: { transferAlias: 'a' } },
    })
    expect(data.preview.changes).toEqual([{ label: 'Alias', before: 'a', after: 'viejo' }])
    expect(data.preview.title).toBe('Deshacer: cambiar la cuenta')
  })

  it('only undoes a confirmed change that kept what it replaced', async () => {
    const ctx: ToolContext = { user: mili, codeIds: [3], conversationId: 4, now, proposed: [] }
    const pending = setup()
    await expect(pending.service.proposeUndo(ctx, 5)).rejects.toThrow('Solo se puede deshacer')

    const noUndo = setup(row({ status: AssistantActionStatus.CONFIRMED, payload: { title: 'x' } }))
    await expect(noUndo.service.proposeUndo(ctx, 5)).rejects.toThrow('no se puede deshacer')
  })

  it('cancels a pending one and leaves the others as they are', async () => {
    const { service, prisma } = setup()
    await service.cancel(mili, 5, now)
    expect(prisma.assistantAction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AssistantActionStatus.CANCELLED } }),
    )

    const done = setup(row({ status: AssistantActionStatus.CONFIRMED }))
    await expect(done.service.cancel(mili, 5, now)).resolves.toEqual(expect.objectContaining({ status: 'confirmed' }))
    expect(done.prisma.assistantAction.update).not.toHaveBeenCalled()
  })
})
