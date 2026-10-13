import { Role, TaskStatus } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { TasksService, type TaskActor } from './tasks.service'

const john: TaskActor = { id: 1, producerId: 7, role: Role.SUPERADMIN }
const mili: TaskActor = { id: 2, producerId: 7, role: Role.ADMIN }
const demis: TaskActor = { id: 3, producerId: 7, role: Role.ADMIN }

function setup(task?: { createdById: number; assignedToId: number }) {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 2 }), findMany: jest.fn().mockResolvedValue([]) },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(task ? { id: 10, ...task } : null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 10 }),
      create: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      count: jest.fn().mockResolvedValue(0),
    },
    taskComment: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([]),
  }
  return { service: new TasksService(prisma as unknown as PrismaService), prisma }
}

describe('TasksService.create', () => {
  it('assigns a task to someone of the office, unseen until they open it', async () => {
    const { service, prisma } = setup()

    await service.create(john, { title: ' Llamar a Pérez ', assignedToUserId: 2, dueDate: '2026-10-14' })

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 2, producerId: 7, role: { not: Role.OWNER } }) }),
    )
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Llamar a Pérez',
          createdById: 1,
          assignedToId: 2,
          producerId: 7,
          seenAt: null,
          dueDate: new Date('2026-10-14T00:00:00.000Z'),
        }),
      }),
    )
  })

  it('rejects a person from another office', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)

    await expect(service.create(john, { title: 'x', assignedToUserId: 99 })).rejects.toThrow('not part of this office')
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('does not flag a note to self as new', async () => {
    const { service, prisma } = setup()

    await service.create(mili, { title: 'Pedir cupones', assignedToUserId: 2 })

    const [{ data }] = prisma.task.create.mock.calls[0] as [{ data: { seenAt: unknown } }]
    expect(data.seenAt).toBeInstanceOf(Date)
  })
})

describe('TasksService.list', () => {
  const whereOf = (prisma: ReturnType<typeof setup>['prisma']) =>
    (prisma.task.findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where

  it('shows the whole office only to a SuperAdmin', async () => {
    const forJohn = setup()
    await forJohn.service.list(john, { view: 'all' })
    expect(whereOf(forJohn.prisma)).not.toHaveProperty('OR')

    const forMili = setup()
    await forMili.service.list(mili, { view: 'all' })
    expect(whereOf(forMili.prisma)).toMatchObject({ OR: [{ assignedToId: 2 }, { createdById: 2 }] })
  })

  it('lists my open tasks by default', async () => {
    const { service, prisma } = setup()
    await service.list(mili, {})
    expect(whereOf(prisma)).toMatchObject({
      assignedToId: 2,
      status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
    })
  })
})

describe('TasksService.update', () => {
  it('lets the assignee finish the task', async () => {
    const { service, prisma } = setup({ createdById: 1, assignedToId: 2 })

    await service.update(mili, 10, { status: TaskStatus.DONE })

    const [{ data }] = prisma.task.update.mock.calls[0] as [{ data: { status: string; completedAt: unknown } }]
    expect(data.status).toBe(TaskStatus.DONE)
    expect(data.completedAt).toBeInstanceOf(Date)
  })

  it('keeps out someone the task does not involve', async () => {
    const { service, prisma } = setup({ createdById: 1, assignedToId: 2 })

    await expect(service.update(demis, 10, { status: TaskStatus.DONE })).rejects.toThrow('not yours')
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it('marks a reassigned task as new for the new person', async () => {
    const { service, prisma } = setup({ createdById: 1, assignedToId: 2 })
    prisma.user.findFirst.mockResolvedValue({ id: 3 })

    await service.update(john, 10, { assignedToUserId: 3 })

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: 3, seenAt: null }) }),
    )
  })
})

describe('TasksService.remove', () => {
  it('only lets whoever created it delete it', async () => {
    const { service } = setup({ createdById: 1, assignedToId: 2 })
    await expect(service.remove(mili, 10)).rejects.toThrow('Only whoever created')
  })
})

describe('TasksService.addComment', () => {
  it('flags the task for the assignee when someone else replies', async () => {
    const { service, prisma } = setup({ createdById: 1, assignedToId: 2 })

    await service.addComment(john, 10, { body: ' ¿Pudiste llamar? ' })

    expect(prisma.taskComment.create).toHaveBeenCalledWith({
      data: { taskId: 10, userId: 1, body: '¿Pudiste llamar?' },
    })
    expect(prisma.task.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { seenAt: null } })
  })
})
