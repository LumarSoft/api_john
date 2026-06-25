import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'

export interface DocumentoResponse {
  codigo: string
  nombre: string
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
    const poliza = await this.prisma.poliza.findFirst({
      where: { id: polizaId, clientId, producerId, deletedAt: null },
      select: { certificado: true },
    })
    if (!poliza) {
      throw new NotFoundException(`Policy ${polizaId} not found`)
    }

    const documentos = await this.triunfo.getDocumentos(poliza.certificado)

    return documentos.map(doc => ({
      codigo: doc.Codigo,
      nombre: doc.Nombre,
      url: doc.Url,
    }))
  }
}
