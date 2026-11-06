import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { accountRows } from './templates-overview'
import { TemplatesOverviewService } from './templates-overview.service'
import { MetaGraphError, MetaTemplate, WabaTemplatesService } from './waba-templates.service'

function meta(overrides: Partial<MetaTemplate> & { name: string }): MetaTemplate {
  return {
    language: 'es_AR',
    category: 'UTILITY',
    status: 'APPROVED',
    rejectedReason: null,
    quality: 'UNKNOWN',
    ...overrides,
  }
}

const rejection = { name: 'aviso_rechazo_pago', lang: 'es_AR', use: 'Avisos de rechazos de pago', managed: true }
const expiry = { name: 'aviso_poliza_vencida', lang: 'es_AR', use: 'Avisos de pólizas vencidas', managed: true }

describe('accountRows', () => {
  it('lists first what the platform needs, marking what the account lacks', () => {
    const rows = accountRows([meta({ name: 'aviso_rechazo_pago', status: 'PENDING' })], [rejection, expiry])

    expect(rows).toEqual([
      expect.objectContaining({ name: 'aviso_rechazo_pago', status: 'PENDING', use: rejection.use, inUse: true }),
      expect.objectContaining({ name: 'aviso_poliza_vencida', status: 'MISSING', category: null, inUse: true }),
    ])
  })

  it('counts a template in another language as missing', () => {
    const rows = accountRows([meta({ name: 'aviso_rechazo_pago', language: 'es' })], [rejection])

    expect(rows[0]).toEqual(expect.objectContaining({ status: 'MISSING', language: 'es_AR' }))
    expect(rows[1]).toEqual(expect.objectContaining({ name: 'aviso_rechazo_pago', language: 'es', inUse: false }))
  })

  it("names an old campaign text and leaves templates the platform doesn't know without a use", () => {
    const rows = accountRows(
      [
        meta({ name: 'promo_navidad', category: 'MARKETING' }),
        meta({ name: 'campana_renovacion_v1', category: 'MARKETING', status: 'REJECTED', rejectedReason: 'SCAM' }),
        meta({ name: 'campana_renovacion_v2', category: 'MARKETING' }),
      ],
      [{ name: 'campana_renovacion_v2', lang: 'es_AR', use: 'Campaña: Renovaciones', managed: true }],
    )

    expect(rows.map(r => [r.name, r.use, r.inUse])).toEqual([
      ['campana_renovacion_v2', 'Campaña: Renovaciones', true],
      ['campana_renovacion_v1', 'Campaña: Renovaciones (texto anterior)', false],
      ['promo_navidad', null, false],
    ])
    expect(rows[1].reason).toBe('Posible estafa según Meta.')
  })

  it('marks the earlier text of a notice the account sends while Meta reviews the new one', () => {
    const notice = { ...rejection, name: 'aviso_rechazo_pago_v2', previous: ['aviso_rechazo_pago'] }

    const reviewing = accountRows(
      [meta({ name: 'aviso_rechazo_pago' }), meta({ name: 'aviso_rechazo_pago_v2', status: 'PENDING' })],
      [notice],
    )
    expect(reviewing.map(r => [r.name, r.status, r.use, r.inUse, r.managed])).toEqual([
      ['aviso_rechazo_pago_v2', 'PENDING', 'Avisos de rechazos de pago', true, true],
      ['aviso_rechazo_pago', 'APPROVED', 'Avisos de rechazos de pago (texto anterior)', true, false],
    ])

    const approved = accountRows(
      [meta({ name: 'aviso_rechazo_pago' }), meta({ name: 'aviso_rechazo_pago_v2' })],
      [notice],
    )
    expect(approved[1]).toEqual(expect.objectContaining({ name: 'aviso_rechazo_pago', inUse: false }))
  })
})

describe('TemplatesOverviewService.overview', () => {
  function setup() {
    const prisma = {
      wabaAccount: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 6,
            wabaId: 'office-waba',
            wabaName: 'Oficina',
            accessToken: 'x',
            producer: { id: 1, name: 'JPMG' },
            phoneNumbers: [{ phoneNumberId: 'meta-8', number: '+54 9 341 000-0001', branchName: '27 de Febrero' }],
          },
          {
            id: 8,
            wabaId: 'branch-waba',
            wabaName: 'Sucursal',
            accessToken: 'y',
            producer: { id: 1, name: 'JPMG' },
            phoneNumbers: [{ phoneNumberId: 'meta-11', number: '+54 9 341 000-0002', branchName: 'Pueblo Esther' }],
          },
        ]),
      },
      salesCampaign: {
        findMany: jest.fn().mockResolvedValue([{ producerId: 1, kind: 'RENEWAL', templateVersion: 1 }]),
      },
    }
    const config = {
      get: jest.fn((key: string) => (key === 'PAYMENT_REJECTION_TEMPLATE' ? 'aviso_rechazo_pago' : undefined)),
    }
    const templates = {
      templatesOf: jest.fn((account: { id: number }) =>
        account.id === 6
          ? Promise.resolve([
              meta({ name: 'aviso_rechazo_pago' }),
              meta({ name: 'campana_renovacion_v1', category: 'MARKETING' }),
            ])
          : Promise.reject(new MetaGraphError('Error validating access token')),
      ),
      numbersOf: jest.fn().mockResolvedValue([{ id: 'meta-8', quality: 'GREEN', messagingLimit: 'TIER_250' }]),
    }
    const service = new TemplatesOverviewService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      templates as unknown as WabaTemplatesService,
    )
    return { service }
  }

  it("groups each organization's accounts with what the platform needs in them", async () => {
    const { service } = setup()

    const result = await service.overview()

    expect(result.organizations).toHaveLength(1)
    const [office, branch] = result.organizations[0].accounts
    expect(office.numbers).toEqual([
      { number: '+54 9 341 000-0001', branchName: '27 de Febrero', quality: 'GREEN', messagingLimit: 'TIER_250' },
    ])
    // The rejection notice's current text is created by the platform; the first one keeps sending meanwhile.
    expect(office.templates.map(t => [t.name, t.status, t.use, t.inUse])).toEqual([
      ['aviso_rechazo_pago_v2', 'MISSING', 'Avisos de rechazos de pago', true],
      ['campana_renovacion_v1', 'APPROVED', 'Campaña: Renovaciones', true],
      ['aviso_rechazo_pago', 'APPROVED', 'Avisos de rechazos de pago (texto anterior)', true],
    ])
    // An account Meta did not answer for says so instead of looking empty.
    expect(branch.error).toContain('Error validating access token')
    expect(branch.templates).toEqual([])
    expect(branch.numbers[0]).toEqual(expect.objectContaining({ quality: null, messagingLimit: null }))
  })
})
