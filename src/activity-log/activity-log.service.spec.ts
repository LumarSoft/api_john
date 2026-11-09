import { EventEmitter } from 'events'
import type { Request, Response } from 'express'
import { ActivityLogMiddleware } from './activity-log.middleware'
import { ActivityLogService } from './activity-log.service'
import { clientIp, fieldNames } from './request-origin'

function createPrismaMock() {
  return {
    activityLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 2, producerId: 1 }),
    },
  }
}

function fakeRequest(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    method: 'PATCH',
    originalUrl: '/users/2',
    url: '/users/2',
    headers: { 'x-real-ip': '190.13.223.10', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    body: {},
    ...overrides,
  } as unknown as Request
}

function fakeResponse(statusCode: number): Response {
  return Object.assign(new EventEmitter(), { statusCode }) as unknown as Response
}

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('ActivityLogService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let service: ActivityLogService
  let middleware: ActivityLogMiddleware

  beforeEach(() => {
    prisma = createPrismaMock()
    service = new ActivityLogService(prisma as any, { get: () => undefined } as any)
    middleware = new ActivityLogMiddleware(service)
  })

  /** Runs a request through the middleware and finishes its response. */
  async function finish(req: Request, statusCode = 200) {
    const res = fakeResponse(statusCode)
    const next = jest.fn()
    middleware.use(req, res, next)
    expect(next).toHaveBeenCalled()
    // Node lets go of the connection once the response is sent.
    ;(req as { socket?: unknown }).socket = undefined
    res.emit('finish')
    await flush()
  }

  it('records a change made by a panel user with the address nginx saw and only the field names', async () => {
    await finish(
      fakeRequest({
        user: { id: 2, producerId: 1, type: 'user' },
        body: { name: 'Rosario', password: 'una-clave-nueva' },
      }),
    )

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 2,
        producerId: 1,
        method: 'PATCH',
        path: '/users/2',
        statusCode: 200,
        ip: '190.13.223.10',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
        fields: 'name,password',
        loginEmail: null,
      },
    })
    expect(JSON.stringify(prisma.activityLog.create.mock.calls)).not.toContain('una-clave-nueva')
  })

  it('records a failed login with the e-mail typed and the account it belongs to, never the password', async () => {
    await finish(
      fakeRequest({
        method: 'POST',
        originalUrl: '/auth/login',
        body: { email: 'oficina@example.com', password: 'mal-escrita' },
      }),
      401,
    )

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'oficina@example.com', deletedAt: null } }),
    )
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 2,
        producerId: 1,
        path: '/auth/login',
        statusCode: 401,
        loginEmail: 'oficina@example.com',
        fields: 'email,password',
      }),
    })
    expect(JSON.stringify(prisma.activityLog.create.mock.calls)).not.toContain('mal-escrita')
  })

  it('keeps a login attempt on an e-mail no account has', async () => {
    prisma.user.findFirst.mockResolvedValue(null)

    await finish(fakeRequest({ method: 'POST', originalUrl: '/auth/login', body: { email: 'nadie@example.com' } }), 401)

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, producerId: null, loginEmail: 'nadie@example.com' }),
    })
  })

  it('records a request the role guard rejected', async () => {
    await finish(fakeRequest({ user: { id: 6, producerId: 1, type: 'user' }, originalUrl: '/users/2' }), 403)

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 6, statusCode: 403 }),
    })
  })

  it('ignores reads, the bot, the client portal and the panel visit markers', async () => {
    await finish(fakeRequest({ method: 'GET', user: { id: 2, producerId: 1, type: 'user' } }))
    await finish(fakeRequest({ method: 'POST', originalUrl: '/bot/messages' }))
    await finish(
      fakeRequest({ method: 'POST', originalUrl: '/portal/x', user: { id: 9, producerId: 1, type: 'client' } }),
    )
    await finish(
      fakeRequest({
        method: 'POST',
        originalUrl: '/admin/novedades/visit',
        user: { id: 2, producerId: 1, type: 'user' },
      }),
    )

    expect(prisma.activityLog.create).not.toHaveBeenCalled()
  })

  it('never fails the request when the row cannot be written', async () => {
    prisma.activityLog.create.mockRejectedValue(new Error('db down'))

    await expect(
      finish(fakeRequest({ user: { id: 2, producerId: 1, type: 'user' }, body: { name: 'x' } })),
    ).resolves.toBeUndefined()
  })

  it('lists the newest first with the filters asked', async () => {
    await service.list({ producerId: 1, ip: '190.13.223.10', failed: true, page: 2, pageSize: 10 })

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, producerId: 1, ip: '190.13.223.10', statusCode: { gte: 400 } },
        orderBy: { id: 'desc' },
        skip: 10,
        take: 10,
      }),
    )
  })

  it('prunes what is older than the retention window', async () => {
    await service.pruneOldEntries()

    const { where } = prisma.activityLog.deleteMany.mock.calls[0][0]
    const days = (Date.now() - where.createdAt.lt.getTime()) / 86_400_000
    expect(Math.round(days)).toBe(180)
  })
})

describe('clientIp', () => {
  it('trusts X-Real-IP only when the request came through nginx on this machine', () => {
    expect(clientIp(fakeRequest())).toBe('190.13.223.10')
    expect(
      clientIp(fakeRequest({ socket: { remoteAddress: '::ffff:181.84.62.228' }, headers: { 'x-real-ip': '1.2.3.4' } })),
    ).toBe('181.84.62.228')
  })

  it('falls back to the socket address when nginx sent no header', () => {
    expect(clientIp(fakeRequest({ headers: {} }))).toBe('127.0.0.1')
  })
})

describe('fieldNames', () => {
  it('keeps only the names', () => {
    expect(fieldNames({ orgName: 'VANESA AGUILAR', orgShortName: 'Vanesa' })).toBe('orgName,orgShortName')
    expect(fieldNames({})).toBeNull()
    expect(fieldNames([1, 2])).toBeNull()
    expect(fieldNames(undefined)).toBeNull()
  })
})
