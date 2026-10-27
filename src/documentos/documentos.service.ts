import { Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService, type TriunfoPolicyRef } from '../triunfo/triunfo.service'
import { documentFilename, documentName, documentOrder } from './document-types'

export interface DocumentoResponse {
  code: string
  name: string
  url: string
}

export interface DocumentoFile {
  filename: string
  buffer: Buffer
}

// Fields RESTDocumentosV2 needs, as RESTNovedadesCartera left them in Policy.rawData.
interface CarteraPolicyData {
  Articulo?: string | number
  Empresa?: string
  Sucursal?: string
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
  findByPoliza(polizaId: number, clientId: number, producerId: number): Promise<DocumentoResponse[]> {
    return this.listForPolicy({ id: polizaId, clientId, producerId, deletedAt: null })
  }

  /**
   * A policy an admin may see: it belongs to the client and producer, and the
   * client is visible to the admin's codes (same rule as the asegurados list).
   */
  adminPolicyWhere(clientId: number, polizaId: number, producerId: number, codeIds: number[]): Prisma.PolicyWhereInput {
    return {
      id: polizaId,
      clientId,
      producerId,
      deletedAt: null,
      client: {
        deletedAt: null,
        OR: [
          { producerCodeId: { in: codeIds } },
          { policies: { some: { deletedAt: null, producerCodeId: { in: codeIds } } } },
        ],
      },
    }
  }

  /** Documents of the policy matched by `where`, most requested first. */
  async listForPolicy(where: Prisma.PolicyWhereInput): Promise<DocumentoResponse[]> {
    const { ref } = await this.resolvePolicy(where)
    if (!ref) return []

    const documentos = await this.triunfo.getDocumentos(ref)
    return documentos
      .map(doc => ({ code: doc.Codigo, name: documentName(doc.Codigo, doc.Nombre), url: doc.URL }))
      .sort((a, b) => documentOrder(a.code) - documentOrder(b.code))
  }

  /** Downloads one document (by Triunfo code) of the policy matched by `where`. */
  async downloadForPolicy(where: Prisma.PolicyWhereInput, code: string): Promise<DocumentoFile> {
    const { ref, reference } = await this.resolvePolicy(where)
    // A fresh list: the link is about to be followed and its lifetime is unknown.
    const documento = ref ? (await this.triunfo.getDocumentos(ref, { fresh: true })).find(d => d.Codigo === code) : null
    if (!documento) throw new NotFoundException(`Document ${code} is not available for this policy`)

    const buffer = await this.triunfo.downloadDocumento(documento.URL)
    return { filename: documentFilename(documentName(code, documento.Nombre), reference), buffer }
  }

  /**
   * Finds the policy and builds what Triunfo needs to locate it. `ref` is null
   * for a policy the cartera never described with an artículo.
   */
  private async resolvePolicy(where: Prisma.PolicyWhereInput) {
    const policy = await this.prisma.policy.findFirst({
      where,
      select: {
        producerId: true,
        certificateNumber: true,
        rawData: true,
        producerCode: { select: { code: true } },
        vehicle: { select: { licensePlate: true } },
      },
    })
    if (!policy) throw new NotFoundException('Policy not found')

    const data = (policy.rawData ?? {}) as CarteraPolicyData
    const ref: TriunfoPolicyRef | null =
      data.Articulo == null
        ? null
        : {
            producerId: policy.producerId,
            productor: policy.producerCode?.code,
            // Every policy of the cartera is T / CC; the default covers the few without them.
            empresa: data.Empresa ?? 'T',
            sucursal: data.Sucursal ?? 'CC',
            articulo: String(data.Articulo),
            certificado: policy.certificateNumber,
          }
    const reference = policy.vehicle?.licensePlate || `póliza ${policy.certificateNumber}`
    return { ref, reference }
  }
}
