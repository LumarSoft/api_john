import type { PrismaService } from '../prisma/prisma.service'
import { AssistantDataService } from './assistant-data.service'

describe('AssistantDataService', () => {
  it('searches only among the clients of the user’s codes and tells each policy’s state', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 60,
        firstName: 'JUAN CARLOS',
        lastName: 'PEREZ',
        dni: '20999001',
        phone: '341159990001',
        policies: [
          {
            certificateNumber: '1234567',
            riskType: 'auto',
            lastMovement: 'RENOVACION',
            validFrom: new Date('2026-01-10T00:00:00Z'),
            validTo: new Date('2027-01-10T00:00:00Z'),
            rawData: {},
            vehicle: { licensePlate: 'AB123CD', brand: 'FORD', model: 'KA', year: 2015 },
          },
        ],
      },
    ])
    const service = new AssistantDataService({ client: { findMany } } as unknown as PrismaService)

    const result = await service.searchClients(7, [3], 'perez AB123CD')

    expect(result).toEqual({
      resultados: [
        {
          id: 60,
          nombre: 'Juan Carlos Perez',
          dni: '20999001',
          telefono: '341159990001',
          polizas: [{ poliza: '1234567', bien: 'Ford Ka 2015 · AB123CD', estado: 'vigente', vence: '10/01/2027' }],
        },
      ],
    })
    const where = findMany.mock.calls[0][0].where
    expect(where.producerId).toBe(7)
    expect(where.AND[0]).toEqual({
      OR: [{ producerCodeId: { in: [3] } }, { policies: { some: { deletedAt: null, producerCodeId: { in: [3] } } } }],
    })
    expect(where.AND).toHaveLength(3)
  })

  it('says so when the client is not one the user can see', async () => {
    const service = new AssistantDataService({
      client: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService)

    await expect(service.clientFile(7, [3], 999)).resolves.toEqual({
      error: expect.stringContaining('No hay un asegurado'),
    })
  })
})
