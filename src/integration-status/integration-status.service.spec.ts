import { BadGatewayException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { parseExplanation, type IncidentExplainerService } from './incident-explainer.service'
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
  aiExplanation: string | null
  aiBlame: string | null
  aiBlameReason: string | null
  aiExplainedAt: Date | null
  aiExplainedFor: string | null
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

const EXPLANATION = {
  explanation:
    'Triunfo dio de baja o movió el servicio de documentación: el bot no puede mandar pólizas ni tarjetas. El resto de Triunfo funciona.',
  blame: 'PROVIDER' as const,
  blameReason: 'Triunfo: dio de baja o movió esta dirección sin avisar',
}

/** Lets the explanation, which nobody awaits, run to the end. */
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
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
  const componentOf = (row: IncidentRow) => [...components.values()].find(c => c.id === row.componentId)
  const withComponent = (row: IncidentRow) => ({
    ...row,
    component: { key: componentOf(row)?.key ?? '', lastSuccessAt: componentOf(row)?.lastSuccessAt ?? null },
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
      findMany: jest.fn(({ where }: { where: { key?: { startsWith: string; not: string } } }) =>
        Promise.resolve(
          [...components.values()]
            .filter(c => !where.key || (c.key.startsWith(where.key.startsWith) && c.key !== where.key.not))
            .map(c => ({ ...c })),
        ),
      ),
    },
    integrationIncident: {
      create: jest.fn(({ data }: { data: Partial<IncidentRow> & Pick<IncidentRow, 'componentId' | 'kind'> }) => {
        const row: IncidentRow = {
          httpStatus: null,
          message: '',
          sample: null,
          startedAt: new Date(),
          lastFailureAt: new Date(),
          ...data,
          id: nextId++,
          failures: 1,
          endedAt: null,
          aiExplanation: null,
          aiBlame: null,
          aiBlameReason: null,
          aiExplainedAt: null,
          aiExplainedFor: null,
          deletedAt: null,
        }
        incidents.set(row.id, row)
        return Promise.resolve({ id: row.id })
      }),
      update: jest.fn(({ where, data }: { where: { id: number }; data: Record<string, unknown> }) =>
        Promise.resolve(applyIncident(incidents.get(where.id)!, data)),
      ),
      findFirst: jest.fn(({ where }: { where: { id?: number; componentId?: number; endedAt?: { gte: Date } } }) => {
        if (where.id !== undefined) {
          const row = incidents.get(where.id)
          return Promise.resolve(row ? withComponent(row) : null)
        }
        const match = [...incidents.values()]
          .filter(i => i.componentId === where.componentId && i.endedAt && i.endedAt >= where.endedAt!.gte)
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
  const explainer = { enabled: true, explain: jest.fn().mockResolvedValue(EXPLANATION) }
  const config = { get: () => undefined } as unknown as ConfigService
  const service = new IntegrationStatusService(
    prisma as unknown as PrismaService,
    explainer as unknown as IncidentExplainerService,
    config,
  )
  const component = (key: string) => components.get(key)!
  return { service, prisma, explainer, components, incidents, component }
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

    const overview = await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
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

    const superAdmin = await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
    const owner = await service.overview({ id: 1, producerId: 9, role: 'OWNER' })

    expect(superAdmin.incidents[0]).not.toHaveProperty('sample')
    expect(owner.incidents[0].sample).toBe(TRIUNFO_404)
  })

  it("gives the SuperAdmin their organization's Triunfo user and numbers, and the OWNER every number", async () => {
    const { service, prisma } = setup()
    prisma.phoneNumber.findMany.mockResolvedValue([
      {
        id: 3,
        number: '+54 341 000-0000',
        producer: { name: 'JPMG' },
        wabaAccount: { disconnectedAt: null, disconnectReason: null, tokenExpiresAt: new Date('2020-01-01') },
      },
    ])

    const overview = await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
    await service.overview({ id: 1, producerId: 9, role: 'OWNER' })

    expect(prisma.phoneNumber.findMany.mock.calls[0][0]).toMatchObject({ where: { producerId: 1 } })
    expect(prisma.phoneNumber.findMany.mock.calls[1][0].where).not.toHaveProperty('producerId')
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

describe('IntegrationStatusService — AI explanation', () => {
  it('hands a new incident to the model once, with how the provider’s other services are doing', async () => {
    const { service, explainer, incidents } = setup()
    await service.succeeded('triunfo.RESTCotizadorAutV2')
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    await settle()
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    await settle()

    expect(explainer.explain).toHaveBeenCalledTimes(1)
    const context = explainer.explain.mock.calls[0][0]
    expect(context).toMatchObject({
      provider: 'Triunfo Seguros',
      failure: {
        kind: 'HTTP_ERROR',
        httpStatus: 404,
        answer: 'ERROR 404 PÁGINA NO ENCONTRADA La página que intenta visitar no existe o ha sido movida.',
      },
      otherServices: [{ service: 'RESTCotizadorAutV2, el cotizador de autos y motos', state: 'funciona' }],
    })
    expect([...incidents.values()][0]).toMatchObject({
      aiBlame: 'PROVIDER',
      aiExplanation: EXPLANATION.explanation,
      aiExplainedFor: 'HTTP_ERROR:404',
    })
  })

  it('shows the explanation, and hides it once the service fails some other way until that is explained', async () => {
    const { service, explainer } = setup()
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    await settle()

    const explained = await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
    expect(explained.components.find(c => c.key === 'triunfo.RESTDocumentosV2')?.incident?.explanation).toMatchObject({
      text: EXPLANATION.explanation,
      blame: 'PROVIDER',
      blameReason: EXPLANATION.blameReason,
    })

    explainer.explain.mockReturnValue(new Promise(() => undefined))
    await service.failed('triunfo.RESTDocumentosV2', { kind: 'TIMEOUT', message: 'timeout of 15000ms exceeded' })
    await settle()
    const changed = await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })

    expect(explainer.explain).toHaveBeenCalledTimes(2)
    expect(changed.components.find(c => c.key === 'triunfo.RESTDocumentosV2')?.incident?.explanation).toBeNull()
  })

  it('never throws when the model fails, and asks again later from the section', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z') })
    const { service, explainer } = setup()
    explainer.explain.mockRejectedValueOnce(new BadGatewayException('timeout'))

    await expect(service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)).resolves.toBeUndefined()
    await settle()
    await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
    expect(explainer.explain).toHaveBeenCalledTimes(1)

    jest.setSystemTime(new Date('2026-11-03T12:11:00Z'))
    await service.overview({ id: 5, producerId: 1, role: 'SUPERADMIN' })
    await settle()
    expect(explainer.explain).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })

  it('asks nothing without an OpenAI key', async () => {
    const { service, explainer } = setup()
    explainer.enabled = false
    await service.failed('triunfo.RESTDocumentosV2', NOT_FOUND)
    await settle()
    expect(explainer.explain).not.toHaveBeenCalled()
  })
})

describe('parseExplanation', () => {
  it('reads what the model answered, cut to the columns', () => {
    expect(parseExplanation(JSON.stringify({ ...EXPLANATION, explanation: 'x'.repeat(700) }))).toMatchObject({
      blame: 'PROVIDER',
      explanation: 'x'.repeat(600),
    })
  })

  it('refuses an answer without an explanation or with an unknown blame', () => {
    expect(() => parseExplanation(JSON.stringify({ ...EXPLANATION, blame: 'LUMARSOFT' }))).toThrow(BadGatewayException)
    expect(() => parseExplanation(JSON.stringify({ ...EXPLANATION, explanation: ' ' }))).toThrow(BadGatewayException)
  })
})
