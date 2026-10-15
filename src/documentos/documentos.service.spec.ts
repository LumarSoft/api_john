import { DocumentosService } from './documentos.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { TriunfoService } from '../triunfo/triunfo.service'

const LINK = (name: string) => `https://www.triunfonet.com.ar/gauswebtriunfo/servlet/${name}?abc`

const POLICY = {
  certificateNumber: '1234567',
  rawData: { Articulo: 458, Empresa: 'T', Sucursal: 'CC' },
  producerCode: { code: '6088' },
  vehicle: { licensePlate: 'AB123CD' },
}

function createService(policy: unknown = POLICY) {
  const prisma = { policy: { findFirst: jest.fn().mockResolvedValue(policy) } }
  const triunfo = {
    getDocumentos: jest.fn().mockResolvedValue([
      { Codigo: '1020', Nombre: 'Poliza', URL: LINK('hpolizap') },
      { Codigo: '1000', Nombre: 'Certificado de Cobertura', URL: LINK('hcertificadoau') },
      { Codigo: '1050', Nombre: 'Tarjeta Mercosur', URL: LINK('htarjetaverdec') },
      { Codigo: '1999', Nombre: '  Un documento nuevo de Triunfo con nombre largo ', URL: LINK('hnuevo') },
    ]),
    downloadDocumento: jest.fn().mockResolvedValue(Buffer.from('%PDF-')),
  }
  const service = new DocumentosService(prisma as unknown as PrismaService, triunfo as unknown as TriunfoService)
  return { service, prisma, triunfo }
}

describe('DocumentosService', () => {
  it('locates the policy in Triunfo with the data the cartera left', async () => {
    const { service, triunfo } = createService()
    await service.listForPolicy({ id: 1 })

    expect(triunfo.getDocumentos).toHaveBeenCalledWith({
      productor: '6088',
      empresa: 'T',
      sucursal: 'CC',
      articulo: '458',
      certificado: '1234567',
    })
  })

  it('lists the most requested documents first, with names that fit WhatsApp', async () => {
    const { service } = createService()
    const docs = await service.listForPolicy({ id: 1 })

    expect(docs.map(d => d.name)).toEqual([
      'Tarjeta verde (Mercosur)',
      'Certificado de cobertura',
      'Póliza',
      'Un documento nuevo de Tr',
    ])
    expect(docs.every(d => d.name.length <= 24)).toBe(true)
  })

  it('returns no documents for a policy without an artículo', async () => {
    const { service, triunfo } = createService({ ...POLICY, rawData: {} })
    expect(await service.listForPolicy({ id: 1 })).toEqual([])
    expect(triunfo.getDocumentos).not.toHaveBeenCalled()
  })

  it('downloads with a fresh link and names the file after the plate', async () => {
    const { service, triunfo } = createService()
    const file = await service.downloadForPolicy({ id: 1 }, '1050')

    expect(triunfo.getDocumentos).toHaveBeenCalledWith(expect.any(Object), { fresh: true })
    expect(triunfo.downloadDocumento).toHaveBeenCalledWith(LINK('htarjetaverdec'))
    expect(file.filename).toBe('Tarjeta verde (Mercosur) - AB123CD.pdf')
  })

  it('names the file after the policy when there is no vehicle', async () => {
    const { service } = createService({ ...POLICY, vehicle: null })
    const file = await service.downloadForPolicy({ id: 1 }, '1020')
    expect(file.filename).toBe('Póliza - póliza 1234567.pdf')
  })

  it('only lets an admin reach policies of clients visible to their codes', () => {
    const { service } = createService()
    expect(service.adminPolicyWhere(7, 12, 1, [2, 3])).toEqual({
      id: 12,
      clientId: 7,
      producerId: 1,
      deletedAt: null,
      client: {
        deletedAt: null,
        OR: [
          { producerCodeId: { in: [2, 3] } },
          { policies: { some: { deletedAt: null, producerCodeId: { in: [2, 3] } } } },
        ],
      },
    })
  })

  it('answers 404 for a document Triunfo does not have', async () => {
    const { service } = createService()
    await expect(service.downloadForPolicy({ id: 1 }, '1060')).rejects.toMatchObject({ status: 404 })
  })
})
