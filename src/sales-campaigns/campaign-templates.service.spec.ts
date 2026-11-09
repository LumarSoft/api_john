import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { CAMPAIGNS } from './campaign-catalog'
import { CampaignTemplatesService } from './campaign-templates.service'

const KEY_HEX = '0'.repeat(64)

function setup() {
  const accessToken = encryptSecret('token-de-prueba', resolveKey(KEY_HEX, 'WABA_TOKEN_ENCRYPTION_KEY'))
  const prisma = {
    wabaAccount: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 6,
          wabaId: 'waba-oficina',
          wabaName: 'Oficina',
          accessToken,
          phoneNumbers: [{ number: '+54 9 341 000-0001' }],
        },
      ]),
    },
  }
  const config = { get: jest.fn((key: string) => (key === 'WABA_TOKEN_ENCRYPTION_KEY' ? KEY_HEX : undefined)) }
  const service = new CampaignTemplatesService(prisma as unknown as PrismaService, config as unknown as ConfigService)
  return { service }
}

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

describe('CampaignTemplatesService', () => {
  const fetchMock = jest.spyOn(global, 'fetch')
  afterEach(() => fetchMock.mockReset())

  it('sends the text to review as a marketing template with Meta variables and examples', async () => {
    const { service } = setup()
    fetchMock.mockReturnValueOnce(reply(200, { id: 'tpl-1', status: 'PENDING', category: 'MARKETING' }))

    const stored = await service.submit(
      1,
      CAMPAIGNS.coverage_upgrade,
      '¡Hola, {nombre}! Tu {bien} con {porcentaje}% menos.',
      3,
    )

    expect(stored).toEqual({
      '6': expect.objectContaining({
        name: 'campana_mejora_cobertura_v3',
        id: 'tpl-1',
        status: 'PENDING',
        reason: null,
      }),
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/waba-oficina/message_templates')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-de-prueba')
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'campana_mejora_cobertura_v3',
      language: 'es_AR',
      category: 'MARKETING',
      components: [
        {
          type: 'BODY',
          text: '¡Hola, {{1}}! Tu {{2}} con {{3}}% menos.',
          example: { body_text: [['Juan', 'Ford Ka', '15']] },
        },
      ],
    })
  })

  it('reads the review of a template that already exists instead of failing', async () => {
    const { service } = setup()
    fetchMock
      .mockReturnValueOnce(
        reply(400, { error: { message: 'Message template already exists', error_subcode: 2388023 } }),
      )
      .mockReturnValueOnce(reply(200, { data: [{ id: 'tpl-1', name: 'campana_renovacion_v1', status: 'APPROVED' }] }))

    const stored = await service.submit(1, CAMPAIGNS.renewal, CAMPAIGNS.renewal.defaultBody, 1)

    expect(stored['6']).toEqual(expect.objectContaining({ status: 'APPROVED', id: 'tpl-1' }))
  })

  it('keeps what Meta says when it refuses the text', async () => {
    const { service } = setup()
    fetchMock.mockReturnValueOnce(
      reply(400, { error: { message: 'Invalid parameter', error_user_msg: 'El cuerpo es muy corto.' } }),
    )

    const stored = await service.submit(1, CAMPAIGNS.cross_sell, CAMPAIGNS.cross_sell.defaultBody, 1)

    expect(stored['6']).toEqual(expect.objectContaining({ status: 'ERROR', reason: 'El cuerpo es muy corto.' }))
  })

  it('asks again only for what is still in review, and explains a rejection', async () => {
    const { service } = setup()
    fetchMock.mockReturnValueOnce(
      reply(200, {
        data: [{ id: 'tpl-1', name: 'campana_renovacion_v2', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }],
      }),
    )
    const checkedAt = '2026-11-04T00:00:00.000Z'

    const refreshed = await service.refresh(1, {
      '6': { name: 'campana_renovacion_v2', id: 'tpl-1', status: 'PENDING', reason: null, checkedAt },
      '9': { name: 'campana_renovacion_v2', id: 'tpl-9', status: 'APPROVED', reason: null, checkedAt },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(refreshed['6']).toEqual(
      expect.objectContaining({ status: 'REJECTED', reason: expect.stringContaining('formato') }),
    )
    expect(refreshed['9'].status).toBe('APPROVED')
    expect(service.approvedAccounts(refreshed)).toEqual(new Map([[9, 'campana_renovacion_v2']]))
  })
})
