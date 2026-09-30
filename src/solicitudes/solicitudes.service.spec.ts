import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { SolicitudesService } from './solicitudes.service'

jest.mock('../siniestros/siniestro-upload.config', () => ({
  ...jest.requireActual('../siniestros/siniestro-upload.config'),
  toStoredAdjuntos: jest.fn(async (files: Express.Multer.File[], tipo: string, prefix: string) =>
    files.map(f => ({ filename: f.filename, url: `${prefix}/${f.filename}`, mimeType: 'image/webp', size: 1, tipo })),
  ),
}))

describe('SolicitudesService — bot take-out documents', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  function setup(lead: { id: number; payload: unknown } | null) {
    const prisma = {
      contactLead: {
        findFirst: jest.fn().mockResolvedValue(lead),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new SolicitudesService(prisma as unknown as PrismaService, {} as ConfigService)
    return { service, prisma }
  }

  const photo = (filename: string) => ({ filename }) as Express.Multer.File

  it('stores the photo under uploads/leads and appends it to the lead payload', async () => {
    const { service, prisma } = setup({ id: 9, payload: { cobertura: 'B1 — Todo Total 1' } })

    const res = await service.attachBotLeadAdjuntos(5, 9, [photo('a.webp')], 'dni_frente')

    expect(prisma.contactLead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9, conversationId: 5, deletedAt: null } }),
    )
    expect(prisma.contactLead.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        payload: {
          cobertura: 'B1 — Todo Total 1',
          adjuntos: [
            { filename: 'a.webp', url: '/uploads/leads/a.webp', mimeType: 'image/webp', size: 1, tipo: 'dni_frente' },
          ],
        },
      },
    })
    expect(res).toEqual({
      leadId: 9,
      adjuntosCount: 1,
      attached: true,
      attachments: [expect.objectContaining({ url: '/uploads/leads/a.webp', tipo: 'dni_frente' })],
    })
  })

  it('keeps the photos already attached', async () => {
    const { service, prisma } = setup({ id: 9, payload: { adjuntos: [{ filename: 'old.webp' }] } })

    await service.attachBotLeadAdjuntos(5, 9, [photo('new.webp')], 'dni_dorso')

    const payload = prisma.contactLead.update.mock.calls[0][0].data.payload as { adjuntos: { filename: string }[] }
    expect(payload.adjuntos.map(a => a.filename)).toEqual(['old.webp', 'new.webp'])
  })

  it('refuses a lead that belongs to another conversation', async () => {
    const { service, prisma } = setup(null)

    await expect(service.attachBotLeadAdjuntos(5, 9, [photo('a.webp')])).rejects.toThrow('not found')
    expect(prisma.contactLead.update).not.toHaveBeenCalled()
  })

  it('hands the panel signed document URLs', async () => {
    const prisma = {
      contactLead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          payload: { cobertura: 'B1', adjuntos: [{ url: '/uploads/leads/a.webp', tipo: 'dni_frente' }] },
          selectedPlan: null,
        }),
      },
    }
    const service = new SolicitudesService(prisma as unknown as PrismaService, {} as ConfigService)

    const detail = (await service.getDetail(1, [1], 'lead', 9)) as unknown as {
      payload: { adjuntos: { url: string }[] }
    }

    expect(detail.payload.adjuntos[0].url).toMatch(/^\/uploads\/leads\/a\.webp\?exp=\d+&sig=/)
  })
})
