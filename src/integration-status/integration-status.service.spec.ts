import type { ConfigService } from '@nestjs/config'
import type { ScopeService } from '../common/scope/scope.service'
import type { PrismaService } from '../prisma/prisma.service'
import { IntegrationStatusService, pageText, type IntegrationFailure } from './integration-status.service'

interface ComponentRow {
  id: number
  key: string
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  openIncidentId: number | null
  deletedAt: null
}
interface IncidentRow {
  id: number
  componentId: number
  kind: string
  httpStatus: number | null
  message: string
  sample: string | null
  failures: number
  startedAt: Date
  lastFailureAt: Date
  endedAt: Date | null
  deletedAt: null
}

// Triunfo's answer on 3/11/2026, cut short as the sample is.
const TRIUNFO_404 =
  '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<title>ERROR 404</title>\n<style>\n' +
  ':root{--verde:#009640}\n*{box-sizing:border-box}\n</style>\n</head>\n<body><main><span>&#128269;</span>' +
  '<h1>P&Aacute;GINA NO ENCONTRADA</h1><p>La página que intenta visitar no existe o ha sido movida.</p></main></body></html>'

const NOT_FOUND: IntegrationFailure = {
  kind: 'HTTP_ERROR',
  httpStatus: 404,
  message: 'HTTP 404 Not Found',
  sample: TRIUNFO_404,
}

/** An in-memory stand-in for the tables the service touches. */
function setup() {
  const components = new Map<string, ComponentRow>()
  const incidents = new Map<number, IncidentRow>()
  let nextId = 1

  const applyIncident = (row: IncidentRow, data: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        ;(row as unknown as Record<string, number>)[field] += (value as { increment: number }).increment
      } else {
        ;(row as unknown as Record<string, unknown>)[field] = value
      }
    }
    return { ...row }
  }
  const withComponent = (row: IncidentRow) => ({
    ...row,
    component: { key: [...components.values()].find(c => c.id === row.componentId)?.key ?? '' },
  })

  const prisma = {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    integrationComponent: {
      upsert: jest.fn(({ where }: { where: { key: string } }) => {
        let row = components.get(where.key)
        if (!row) {
          row = {
            id: nextId++,
            key: where.key,
            lastSuccessAt: null,
            lastFailureAt: null,
            openIncidentId: null,
            deletedAt: null,
          }
          components.set(where.key, row)
        }
        return Promise.resolve({ ...row })
      }),
      update: jest.fn(({ where, data }: { where: { id: number }; data: Partial<ComponentRow> }) => {
        const row = [...components.values()].find(c => c.id === where.id)!
        Object.assign(row, data)
        return Promise.resolve({ ...row })
      }),
      findMany: jest.fn(() => Promise.resolve([...components.values()].map(c => ({ ...c })))),
    },
    integrationIncident: {
      create: jest.fn(({ data }: { data: Omit<IncidentRow, 'id' | 'failures' | 'endedAt' | 'deletedAt'> }) => {
        const row: IncidentRow = {
          sample: null,
          ...data,
          id: nextId++,
          failures: 1,
          endedAt: null,
          deletedAt: null,
        }
        incidents.set(row.id, row)
        return Promise.resolve({ id: row.id })
      }),
      update: jest.fn(({ where, data }: { where: { id: number }; data: Record<string, unknown> }) =>
        Promise.resolve(applyIncident(incidents.get(where.id)!, data)),
      ),
      findFirst: jest.fn(({ where }: { where: { componentId: number; endedAt: { gte: Date } } }) => {
        const match = [...incidents.values()]
          .filter(i => i.componentId === where.componentId && i.endedAt && i.endedAt >= where.endedAt.gte)
          .sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime())[0]
        return Promise.resolve(match ? { id: match.id } : null)
      }),
      findMany: jest.fn(({ where }: { where: { id?: { in: number[] } } }) => {
        const rows = [...incidents.values()].filter(i => !where.id || where.id.in.includes(i.id))
        return Promise.resolve(rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).map(withComponent))
      }),
    },
    triunfoAuthStatus: { findMany: jest.fn().mockResolvedValue([]) },
    producer: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1,
        name: 'JPMG',
        slug: 'john',
        triunfoCredential: null,
        triunfoAuthStatus: null,
      }),
    },
    phoneNumber: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const scope = { ownMetaPhoneNumberIds: jest.fn().mockResolvedValue(null) }
  const config = { get: () => undefined } as unknown as ConfigService
  const service = new IntegrationStatusService(
    prisma as unknown as PrismaService,
    scope as unknown as ScopeService,
    config,
  )
  const component = (key: string) => components.get(key)!
  return { service, prisma, scope, components, incidents, component }
}

describe('IntegrationStatusService — reports', () => {
  afterEach(() => jest.useRealTimers())

  it('opens an incident on the first failure, adds to it, and ends it on the next success', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-03T03:32:00Z') })
    const { service, incidents, component } = setup()

    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    jest.setSystemTime(new Date('2026-11-03T16:25:00Z'))
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)

    expect(incidents.size).toBe(1)
    const incident = [...incidents.values()][0]
    expect(incident).toMatchObject({ failures: 2, httpStatus: 404, endedAt: null })
    expect(incident.startedAt).toEqual(new Date('2026-11-03T03:32:00Z'))
    expect(component('triunfo.RESTDocumentosV2').openIncidentId).toBe(incident.id)

    jest.setSystemTime(new Date('2026-11-03T18:00:00Z'))
    await service.succeeded('triunfo.RESTDocumentosV2')

    expect(incident.endedAt).toEqual(new Date('2026-11-03T18:00:00Z'))
    expect(component('triunfo.RESTDocumentosV2')).toMatchObject({
      openIncidentId: null,
      lastSuccessAt: new Date('2026-11-03T18:00:00Z'),
    })
  })

  it('writes the last success at most once a minute while nothing fails', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z') })
    const { service, prisma } = setup()

    await service.succeeded('triunfo.RESTCotizadorAutV2')
    jest.setSystemTime(new Date('2026-11-03T12:00:30Z'))
    await service.succeeded('triunfo.RESTCotizadorAutV2')
    jest.setSystemTime(new Date('2026-11-03T12:01:01Z'))
    await service.succeeded('triunfo.RESTCotizadorAutV2')

    expect(prisma.integrationComponent.update).toHaveBeenCalledTimes(2)
  })

  it('reopens an incident that ended minutes ago instead of opening another', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z') })
    const { service, incidents } = setup()

    await service.failed('infoauto.cars', { kind: 'TIMEOUT', message: 'timeout of 15000ms exceeded' })
    jest.setSystemTime(new Date('2026-11-03T12:02:00Z'))
    await service.succeeded('infoauto.cars')
    jest.setSystemTime(new Date('2026-11-03T12:10:00Z'))
    await service.failed('infoauto.cars', { kind: 'TIMEOUT', message: 'timeout of 15000ms exceeded' })

    expect(incidents.size).toBe(1)
    expect([...incidents.values()][0]).toMatchObject({ failures: 2, endedAt: null })

    jest.setSystemTime(new Date('2026-11-03T12:20:00Z'))
    await service.succeeded('infoauto.cars')
    jest.setSystemTime(new Date('2026-11-03T13:00:00Z'))
    await service.failed('infoauto.cars', { kind: 'NETWORK', message: 'ECONNREFUSED' })

    expect(incidents.size).toBe(2)
  })

  it('serializes reports of one component, so concurrent failures share one incident', async () => {
    const { service, incidents } = setup()
    await Promise.all([
      service.failed('triunfo.documentDownload', NOT_FOUND),
      service.failed('triunfo.documentDownload', NOT_FOUND),
      service.failed('triunfo.documentDownload', NOT_FOUND),
    ])
    expect(incidents.size).toBe(1)
    expect([...incidents.values()][0].failures).toBe(3)
  })

  it('never throws, even when the database does, and reads the table again next time', async () => {
    const { service, prisma } = setup()
    prisma.integrationComponent.upsert.mockRejectedValueOnce(new Error('db down'))

    await expect(service.failed('triunfo.getTokenRest', NOT_FOUND)).resolves.toBeUndefined()
    await service.failed('triunfo.getTokenRest', NOT_FOUND)

    expect(prisma.integrationComponent.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.integrationIncident.create).toHaveBeenCalledTimes(1)
  })
})

describe('IntegrationStatusService — overview', () => {
  it('lists every component: failing with its incident, working, or never used', async () => {
    const { service } = setup()
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    await service.succeeded('triunfo.RESTCotizadorAutV2')

    const overview = await service.overview({ id: 5, producerId: 1, role: 'ADMIN' })
    const byKey = new Map(overview.components.map(c => [c.key, c]))

    expect(overview.components).toHaveLength(7)
    expect(byKey.get('triunfo.RESTDocumentosV2')).toMatchObject({
      status: 'failing',
      incident: {
        httpStatus: 404,
        failures: 1,
        answer: 'ERROR 404 PÁGINA NO ENCONTRADA La página que intenta visitar no existe o ha sido movida.',
      },
    })
    expect(byKey.get('triunfo.RESTCotizadorAutV2')).toMatchObject({ status: 'operational', incident: null })
    expect(byKey.get('infoauto.motorcycles')).toMatchObject({ status: 'unknown', lastSuccessAt: null })
    expect(overview.incidents).toHaveLength(1)
  })

  it('shows the raw answer to the OWNER only', async () => {
    const { service } = setup()
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)

    const admin = await service.overview({ id: 5, producerId: 1, role: 'ADMIN' })
    const owner = await service.overview({ id: 1, producerId: 9, role: 'OWNER' })

    expect(admin.incidents[0]).not.toHaveProperty('sample')
    expect(owner.incidents[0].sample).toBe(TRIUNFO_404)
  })

  it("gives an admin their organization's Triunfo user and only their own numbers", async () => {
    const { service, prisma, scope } = setup()
    scope.ownMetaPhoneNumberIds.mockResolvedValue(['meta-1'])
    prisma.phoneNumber.findMany.mockResolvedValue([
      {
        id: 3,
        number: '+54 341 275-7294',
        producer: { name: 'JPMG' },
        wabaAccount: { disconnectedAt: null, disconnectReason: null, tokenExpiresAt: new Date('2020-01-01') },
      },
    ])

    const overview = await service.overview({ id: 5, producerId: 1, role: 'ADMIN' })

    expect(prisma.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ producerId: 1, phoneNumberId: { in: ['meta-1'] } }) }),
    )
    // Meta's permission expired: the number no longer sends.
    expect(overview.whatsapp[0].status).toBe('failing')
    expect(overview.triunfoAccess).toEqual([
      { producerId: 1, producerName: 'JPMG', configured: true, failingSince: null, failureMessage: null },
    ])
  })
})

describe('pageText', () => {
  it("reads an error page's visible text, even cut short inside a style", () => {
    expect(pageText(TRIUNFO_404)).toBe(
      'ERROR 404 PÁGINA NO ENCONTRADA La página que intenta visitar no existe o ha sido movida.',
    )
    expect(pageText('<html><head><title>502 Bad Gateway</title><style>body{')).toBe('502 Bad Gateway')
  })

  it('gives nothing for an answer that is not a page', () => {
    expect(pageText('{"SDTWSDocumentosOut":null}')).toBeNull()
    expect(pageText('%PDF-1.4')).toBeNull()
    expect(pageText(null)).toBeNull()
  })
})
