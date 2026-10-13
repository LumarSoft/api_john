import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Role, TaskStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTaskCommentDto, CreateTaskDto, ListTasksDto, UpdateTaskDto } from './dto/task.dto'

/** The signed-in person, as the controllers pass it. */
export interface TaskActor {
  id: number
  producerId: number
  role?: Role
}

const PERSON_SELECT = { id: true, name: true, email: true } as const

const TASK_INCLUDE = {
  createdBy: { select: PERSON_SELECT },
  assignedTo: { select: PERSON_SELECT },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, body: true, createdAt: true, user: { select: PERSON_SELECT } },
  },
} as const

const OPEN_STATUSES: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS]
// Finished tasks are history: the list shows the latest ones.
const DONE_LIMIT = 100

function toDate(day: string | null | undefined): Date | null | undefined {
  if (day === undefined) return undefined
  return day === null ? null : new Date(`${day}T00:00:00.000Z`)
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** People of the office a task can be assigned to. */
  people(producerId: number) {
    return this.prisma.user.findMany({
      where: { producerId, deletedAt: null, role: { not: Role.OWNER } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { ...PERSON_SELECT, role: true },
    })
  }

  list(actor: TaskActor, dto: ListTasksDto) {
    const done = dto.status === 'done'
    return this.prisma.task.findMany({
      where: {
        producerId: actor.producerId,
        deletedAt: null,
        status: done ? TaskStatus.DONE : { in: OPEN_STATUSES },
        ...this.viewFilter(actor, dto.view ?? 'mine'),
      },
      orderBy: done ? [{ completedAt: 'desc' }] : [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: done ? DONE_LIMIT : undefined,
      include: TASK_INCLUDE,
    })
  }

  /** Sidebar badge: open tasks assigned to me, and how many I haven't seen yet. */
  async stats(actor: TaskActor) {
    const mine = {
      producerId: actor.producerId,
      assignedToId: actor.id,
      deletedAt: null,
      status: { in: OPEN_STATUSES },
    }
    const [open, unseen] = await Promise.all([
      this.prisma.task.count({ where: mine }),
      this.prisma.task.count({ where: { ...mine, seenAt: null } }),
    ])
    return { open, unseen }
  }

  /** The assignee opened their tasks: nothing of theirs is new any more. */
  async markSeen(actor: TaskActor) {
    const { count } = await this.prisma.task.updateMany({
      where: { producerId: actor.producerId, assignedToId: actor.id, deletedAt: null, seenAt: null },
      data: { seenAt: new Date() },
    })
    return { seen: count }
  }

  async create(actor: TaskActor, dto: CreateTaskDto) {
    await this.assertAssignable(actor.producerId, dto.assignedToUserId)
    return this.prisma.task.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        dueDate: toDate(dto.dueDate) ?? null,
        contactName: dto.contactName?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        producerId: actor.producerId,
        createdById: actor.id,
        assignedToId: dto.assignedToUserId,
        // A note to self is not news to anyone.
        seenAt: dto.assignedToUserId === actor.id ? new Date() : null,
      },
      include: TASK_INCLUDE,
    })
  }

  async update(actor: TaskActor, id: number, dto: UpdateTaskDto) {
    const task = await this.findAccessible(actor, id)
    const reassigned = dto.assignedToUserId !== undefined && dto.assignedToUserId !== task.assignedToId
    if (reassigned) await this.assertAssignable(actor.producerId, dto.assignedToUserId as number)

    return this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() || null } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone.trim() || null } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: toDate(dto.dueDate) } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status, completedAt: dto.status === TaskStatus.DONE ? new Date() : null }
          : {}),
        ...(reassigned
          ? {
              assignedToId: dto.assignedToUserId,
              seenAt: dto.assignedToUserId === actor.id ? new Date() : null,
            }
          : {}),
      },
      include: TASK_INCLUDE,
    })
  }

  async remove(actor: TaskActor, id: number) {
    const task = await this.findAccessible(actor, id)
    if (task.createdById !== actor.id && actor.role !== Role.SUPERADMIN) {
      throw new ForbiddenException('Only whoever created the task can delete it')
    }
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  /** A reply on the task. A reply from someone else flags it as news for the assignee. */
  async addComment(actor: TaskActor, id: number, dto: CreateTaskCommentDto) {
    const task = await this.findAccessible(actor, id)
    await this.prisma.$transaction([
      this.prisma.taskComment.create({ data: { taskId: id, userId: actor.id, body: dto.body.trim() } }),
      this.prisma.task.update({
        where: { id },
        data: task.assignedToId === actor.id ? { updatedAt: new Date() } : { seenAt: null },
      }),
    ])
    return this.prisma.task.findUniqueOrThrow({ where: { id }, include: TASK_INCLUDE })
  }

  private viewFilter(actor: TaskActor, view: 'mine' | 'created' | 'all'): Prisma.TaskWhereInput {
    if (view === 'mine') return { assignedToId: actor.id }
    if (view === 'created') return { createdById: actor.id }
    // The whole office is the SuperAdmin's view; anyone else sees what involves them.
    if (actor.role === Role.SUPERADMIN) return {}
    return { OR: [{ assignedToId: actor.id }, { createdById: actor.id }] }
  }

  /** The task, if the actor created it, has it assigned, or is a SuperAdmin. */
  private async findAccessible(actor: TaskActor, id: number) {
    const task = await this.prisma.task.findFirst({
      where: { id, producerId: actor.producerId, deletedAt: null },
      select: { id: true, createdById: true, assignedToId: true },
    })
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    const involved = task.createdById === actor.id || task.assignedToId === actor.id
    if (!involved && actor.role !== Role.SUPERADMIN) throw new ForbiddenException('This task is not yours')
    return task
  }

  private async assertAssignable(producerId: number, userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, producerId, deletedAt: null, role: { not: Role.OWNER } },
      select: { id: true },
    })
    if (!user) throw new BadRequestException('That person is not part of this office')
  }
}
