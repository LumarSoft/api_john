import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'

export interface DocumentoResponse {
  code: string
  name: string
  url: string
}

@Injectable()
export class DocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
  ) {}

  /**
   * Returns the documents of a policy, fetched on demand from Triunfo.
   * The policy must belong to the authenticated client in this tenant.
   */
  async findByPoliza(polizaId: number, clientId: number, producerId: number): Promise<DocumentoResponse[]> {
    const poliza = await this.prisma.policy.findFirst({
      where: { id: polizaId, clientId, producerId, deletedAt: null },
      select: { certificateNumber: true },
    })
    if (!poliza) {
      throw new NotFoundException(`Policy ${polizaId} not found`)
    }

    const documentos = await this.triunfo.getDocumentos(poliza.certificateNumber)

    return documentos.map(doc => ({
      code: doc.Codigo,
      name: doc.Nombre,
      url: doc.Url,
    }))
  }
}
