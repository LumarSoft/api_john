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

const rejection = { name: 'aviso_rechazo_pago', lang: 'es_AR', use: 'Avisos de rechazos de pago' }
const expiry = { name: 'aviso_poliza_vencida', lang: 'es_AR', use: 'Avisos de pólizas vencidas' }

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
      [{ name: 'campana_renovacion_v2', lang: 'es_AR', use: 'Campaña: Renovaciones' }],
    )

    expect(rows.map(r => [r.name, r.use, r.inUse])).toEqual([
      ['campana_renovacion_v2', 'Campaña: Renovaciones', true],
      ['campana_renovacion_v1', 'Campaña: Renovaciones (texto anterior)', false],
      ['promo_navidad', null, false],
    ])
    expect(rows[1].reason).toBe('Posible estafa según Meta.')
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
    expect(office.templates.map(t => [t.name, t.status, t.use])).toEqual([
      ['aviso_rechazo_pago', 'APPROVED', 'Avisos de rechazos de pago'],
      ['campana_renovacion_v1', 'APPROVED', 'Campaña: Renovaciones'],
    ])
    // An account Meta did not answer for says so instead of looking empty.
    expect(branch.error).toContain('Error validating access token')
    expect(branch.templates).toEqual([])
    expect(branch.numbers[0]).toEqual(expect.objectContaining({ quality: null, messagingLimit: null }))
  })
})
