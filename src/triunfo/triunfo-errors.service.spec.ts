import { AxiosError, AxiosHeaders } from 'axios'
import type { ConfigService } from '@nestjs/config'
import type { IntegrationStatusService } from '../integration-status/integration-status.service'
import type { MailService } from '../mail/mail.service'
import type { PrismaService } from '../prisma/prisma.service'
import {
  bodySample,
  describeException,
  fingerprintOf,
  TriunfoErrorsService,
  type TriunfoFailure,
} from './triunfo-errors.service'

interface ErrorRow {
  fingerprint: string
  producerId: number
  occurrences: number
  lastSeenAt: Date
  sample: string | null
}
interface StatusRow {
  id: number
  producerId: number
  failingSince: Date | null
  failureMessage: string | null
  lastAlertAt: Date | null
  notificationId: number | null
}

const REFUSAL: TriunfoFailure = {
  operation: 'getTokenRest',
  producerId: 1,
  kind: 'CREDENTIALS_REJECTED',
  message: 'Error Generando Token - Revisar los datos ingresados',
}
const NEW_HEADER: TriunfoFailure = {
  operation: 'documentDownload',
  producerId: 1,
  kind: 'HTTP_ERROR',
  httpStatus: 403,
  message: 'HTTP 403',
}

/** An in-memory stand-in for the tables the service touches. */
function setup(env: Record<string, string> = { TRIUNFO_ALERT_EMAIL: 'alertas@lumarsoft.com' }) {
  const errors = new Map<string, ErrorRow>()
  const statuses = new Map<number, StatusRow>()
  const notifications: Array<{ id: number; producerId: number; status: string; type: string; refId: number }> = []

  const matches = (row: StatusRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, cond]) => {
      if (field === 'OR') {
        return (cond as Array<Record<string, unknown>>).some(alt => matches(row, alt))
      }
      const value = row[field as keyof StatusRow]
      if (cond === null) return value === null
      if (cond && typeof cond === 'object' && 'not' in cond) return value !== null
      if (cond && typeof cond === 'object' && 'lt' in cond)
        return value !== null && (value as Date) < (cond as { lt: Date }).lt
      if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime()
      return value === cond
    })

  const prisma = {
    producer: {
      findFirst: jest.fn(({ where }: { where: { id?: number; slug?: string } }) =>
        Promise.resolve(where.slug === 'john' ? { id: 1 } : { name: where.id === 1 ? 'JPMG' : 'Otra' }),
      ),
    },
    user: {
      findMany: jest.fn(({ where }: { where: { role: string } }) =>
        Promise.resolve(
          where.role === 'OWNER' ? [{ email: 'lumar@lumarsoft.com' }] : [{ email: 'john@jpmanagementgroup.com.ar' }],
        ),
      ),
    },
    triunfoError: {
      // Copies, as Prisma returns: a later update must not change what was read.
      findUnique: jest.fn(({ where }: { where: { fingerprint: string } }) => {
        const row = errors.get(where.fingerprint)
        return Promise.resolve(row ? { ...row } : null)
      }),
      create: jest.fn(({ data }: { data: ErrorRow }) => {
        errors.set(data.fingerprint, { ...data, occurrences: 1 })
        return Promise.resolve(data)
      }),
      update: jest.fn(({ where, data }: { where: { fingerprint: string }; data: { lastSeenAt: Date } }) => {
        const row = errors.get(where.fingerprint) as ErrorRow
        row.occurrences++
        row.lastSeenAt = data.lastSeenAt
        return Promise.resolve(row)
      }),
    },
    triunfoAuthStatus: {
      upsert: jest.fn(({ where }: { where: { producerId: number } }) => {
        if (!statuses.has(where.producerId)) {
          statuses.set(where.producerId, {
            id: statuses.size + 1,
            producerId: where.producerId,
            failingSince: null,
            failureMessage: null,
            lastAlertAt: null,
            notificationId: null,
          })
        }
        return Promise.resolve(statuses.get(where.producerId))
      }),
      updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Partial<StatusRow> }) => {
        const row = statuses.get(where.producerId as number)
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 })
        Object.assign(row, data)
        return Promise.resolve({ count: 1 })
      }),
      update: jest.fn(({ where, data }: { where: { producerId: number }; data: Partial<StatusRow> }) =>
        Promise.resolve(Object.assign(statuses.get(where.producerId) as StatusRow, data)),
      ),
      findUnique: jest.fn(({ where }: { where: { producerId: number } }) => {
        const row = statuses.get(where.producerId)
        return Promise.resolve(row ? { ...row } : null)
      }),
      findFirst: jest.fn(({ where }: { where: { producerId: number } }) => {
        const row = statuses.get(where.producerId)
        return Promise.resolve(row ? { ...row } : null)
      }),
    },
    notification: {
      create: jest.fn(({ data }: { data: { producerId: number; type: string; refId: number } }) => {
        const row = { ...data, id: notifications.length + 100, status: 'pending' }
        notifications.push(row)
        return Promise.resolve(row)
      }),
      updateMany: jest.fn(({ where, data }: { where: { id: number }; data: { status: string } }) => {
        const row = notifications.find(n => n.id === where.id)
        if (row) row.status = data.status
        return Promise.resolve({ count: row ? 1 : 0 })
      }),
    },
  }
  const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  const status = {
    succeeded: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
  }
  const service = new TriunfoErrorsService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    status as unknown as IntegrationStatusService,
    config,
  )
  return { service, prisma, mail, status, errors, statuses, notifications }
}

describe('TriunfoErrorsService — failures', () => {
  afterEach(() => jest.useRealTimers())

  it('keeps one row per distinct failure and counts it', async () => {
    const { service, errors } = setup()
    await service.record(NEW_HEADER)
    await service.record(NEW_HEADER)

    expect(errors.size).toBe(1)
    expect([...errors.values()][0].occurrences).toBe(2)
  })

  it('mails Lumarsoft the first time a failure shows up, and not again', async () => {
    const { service, mail } = setup()
    await service.record(NEW_HEADER)
    await service.record(NEW_HEADER)

    expect(mail.sendAlert).toHaveBeenCalledTimes(1)
    const alert = mail.sendAlert.mock.calls[0][0] as { to: string[]; subject: string }
    expect(alert.to).toEqual(['lumar@lumarsoft.com', 'alertas@lumarsoft.com'])
    expect(alert.subject).toContain('Error nuevo de Triunfo en documentDownload')
  })

  it('mails again when a failure comes back after a quiet week', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z') })
    const { service, mail } = setup()
    await service.record(NEW_HEADER)

    jest.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    await service.record(NEW_HEADER)

    expect(mail.sendAlert).toHaveBeenCalledTimes(2)
    expect((mail.sendAlert.mock.calls[1][0] as { subject: string }).subject).toContain('Volvió un error')
  })

  it('records the default organization when the call had none', async () => {
    const { service, errors } = setup()
    await service.record({ ...NEW_HEADER, producerId: null })
    expect([...errors.values()][0].producerId).toBe(1)
  })

  it('never throws, even when the database does', async () => {
    const { service, prisma } = setup()
    prisma.triunfoError.findUnique.mockRejectedValue(new Error('db down'))
    await expect(service.record(NEW_HEADER)).resolves.toBeUndefined()
  })
})

describe('TriunfoErrorsService — Status section', () => {
  it('reports a failure of the service itself, with what it answered', async () => {
    const { service, status } = setup()
    await service.record({ ...NEW_HEADER, operation: 'RESTDocumentosV2', httpStatus: 404, sample: '<html>404</html>' })

    expect(status.failed).toHaveBeenCalledWith('triunfo.RESTDocumentosV2', {
      kind: 'HTTP_ERROR',
      httpStatus: 404,
      message: 'HTTP 403',
      sample: '<html>404</html>',
    })
    expect(status.succeeded).not.toHaveBeenCalled()
  })

  it('takes a refusal as Triunfo answering: about the request or the credentials, not the service', async () => {
    const { service, status } = setup()
    await service.record({
      operation: 'RESTDocumentosV2',
      producerId: 1,
      kind: 'REJECTED',
      message: 'Operación inexistente o no asociada al productor',
    })
    await service.record(REFUSAL)

    expect(status.succeeded.mock.calls).toEqual([['triunfo.RESTDocumentosV2'], ['triunfo.getTokenRest']])
    expect(status.failed).not.toHaveBeenCalled()
  })
})

describe('TriunfoErrorsService — credential outages', () => {
  afterEach(() => jest.useRealTimers())

  it('opens the outage on the first refusal: a notice and a mail to the SuperAdmins and Lumarsoft', async () => {
    const { service, mail, statuses, notifications } = setup()
    await service.record(REFUSAL)

    expect(statuses.get(1)).toMatchObject({ failureMessage: REFUSAL.message, notificationId: 100 })
    expect(statuses.get(1)?.failingSince).toBeInstanceOf(Date)
    expect(notifications).toEqual([expect.objectContaining({ producerId: 1, type: 'triunfo', status: 'pending' })])
    expect(mail.sendAlert).toHaveBeenCalledTimes(1)
    const alert = mail.sendAlert.mock.calls[0][0] as { to: string[]; subject: string; text: string }
    expect(alert.to).toEqual(['john@jpmanagementgroup.com.ar', 'lumar@lumarsoft.com', 'alertas@lumarsoft.com'])
    expect(alert.subject).toBe('⚠️ Triunfo rechaza las credenciales — JPMG')
    expect(alert.text).toContain('Error Generando Token - Revisar los datos ingresados')
  })

  it('stays quiet on further refusals the same day and reminds once a day after', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T23:19:00Z') })
    const { service, mail, notifications } = setup()
    await service.record(REFUSAL)
    jest.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    await service.record(REFUSAL)
    expect(mail.sendAlert).toHaveBeenCalledTimes(1)

    jest.setSystemTime(new Date('2026-10-31T23:20:00Z'))
    await service.record(REFUSAL)
    await service.record(REFUSAL)

    expect(mail.sendAlert).toHaveBeenCalledTimes(2)
    const reminder = mail.sendAlert.mock.calls[1][0] as { subject: string; text: string }
    expect(reminder.subject).toContain('sigue rechazando')
    expect(reminder.text).toContain('Ya lleva 24 h')
    expect(notifications).toHaveLength(1)
  })

  it('does not mail the refusal as a new failure on top of the outage', async () => {
    const { service, mail } = setup()
    await service.record(REFUSAL)
    expect(mail.sendAlert).toHaveBeenCalledTimes(1)
  })

  it('closes the outage when the credentials work again: resolves the notice and says so', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T23:19:00Z') })
    const { service, mail, statuses, notifications } = setup()
    await service.record(REFUSAL)

    jest.setSystemTime(new Date('2026-11-01T00:23:00Z'))
    await service.credentialsAccepted(1)
    await service.credentialsAccepted(1)

    expect(statuses.get(1)).toMatchObject({ failingSince: null, failureMessage: null, notificationId: null })
    expect(notifications[0].status).toBe('resolved')
    expect(mail.sendAlert).toHaveBeenCalledTimes(2)
    const recovered = mail.sendAlert.mock.calls[1][0] as { subject: string; text: string }
    expect(recovered.subject).toBe('✅ Triunfo volvió a aceptar las credenciales — JPMG')
    expect(recovered.text).toContain('después de 25 h 4 min')
  })

  it('does nothing when the credentials were not failing', async () => {
    const { service, mail, prisma } = setup()
    await service.credentialsAccepted(1)
    expect(prisma.triunfoAuthStatus.updateMany).not.toHaveBeenCalled()
    expect(mail.sendAlert).not.toHaveBeenCalled()
  })

  it('reports the outage to the panel', async () => {
    const { service } = setup()
    await expect(service.authState(1)).resolves.toEqual({ failingSince: null, failureMessage: null })
    await service.record(REFUSAL)
    await expect(service.authState(1)).resolves.toMatchObject({ failureMessage: REFUSAL.message })
  })
})

describe('fingerprintOf', () => {
  it('treats the same message with other numbers as the same failure', () => {
    const a = fingerprintOf(1, { ...NEW_HEADER, message: 'Póliza 458-1905860 inexistente' })
    const b = fingerprintOf(1, { ...NEW_HEADER, message: 'Póliza 128-1201794   inexistente' })
    expect(a).toBe(b)
  })

  it('tells organizations, operations, kinds and statuses apart', () => {
    const base = fingerprintOf(1, NEW_HEADER)
    expect(fingerprintOf(2, NEW_HEADER)).not.toBe(base)
    expect(fingerprintOf(1, { ...NEW_HEADER, operation: 'RESTDocumentosV2' })).not.toBe(base)
    expect(fingerprintOf(1, { ...NEW_HEADER, kind: 'UNEXPECTED_RESPONSE' })).not.toBe(base)
    expect(fingerprintOf(1, { ...NEW_HEADER, httpStatus: 500 })).not.toBe(base)
  })
})

describe('describeException', () => {
  const config = { headers: new AxiosHeaders() }

  it('reads an HTTP error with the page Triunfo answered', () => {
    const response = { status: 403, statusText: 'Forbidden', data: '<html>blocked</html>', headers: {}, config }
    const err = new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', config, null, response)
    expect(describeException(err)).toEqual({
      kind: 'HTTP_ERROR',
      httpStatus: 403,
      message: 'HTTP 403 Forbidden',
      sample: '<html>blocked</html>',
    })
  })

  it('tells a timeout from no connection at all', () => {
    expect(describeException(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED')).kind).toBe('TIMEOUT')
    expect(describeException(new AxiosError('getaddrinfo ENOTFOUND www.triunfonet.com.ar', 'ENOTFOUND'))).toEqual({
      kind: 'NETWORK',
      message: 'ENOTFOUND: getaddrinfo ENOTFOUND www.triunfonet.com.ar',
    })
  })

  it('takes anything else as an answer we could not read', () => {
    expect(describeException(new SyntaxError('Unexpected token <'))).toEqual({
      kind: 'UNEXPECTED_RESPONSE',
      message: 'Unexpected token <',
    })
  })
})

describe('bodySample', () => {
  it('reads a downloaded page as UTF-8 and the start of anything else byte by byte', () => {
    expect(bodySample(Buffer.from('<!DOCTYPE html><h1>PÁGINA NO ENCONTRADA</h1>', 'utf8'))).toBe(
      '<!DOCTYPE html><h1>PÁGINA NO ENCONTRADA</h1>',
    )
    expect(bodySample(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xe2, 0xe3]))).toBe('%PDF-âã')
  })
})
