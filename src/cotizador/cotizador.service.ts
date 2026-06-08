import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../prisma/prisma.service'
import { TriunfoService } from '../triunfo/triunfo.service'
import { CotizarAutoDto } from './dto/cotizar-auto.dto'

@Injectable()
export class CotizadorService {
  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
  ) {}

  async cotizarAuto(dto: CotizarAutoDto, producerId: number, userId: number | null) {
    const auth = await this.triunfo.getAuth()

    const response = await firstValueFrom(
      this.httpService.post(`${this.triunfo.baseUrlSip}/RESTCotizadorAutV2`, {
        SDTSrvCotizacionIn: {
          Automotor: {
            Accesorios: [],
            Adicionales: [],
            AnioFabricacion: dto.manufactureYear,
            Bonificacion: '0',
            Catalogo: 'IA',
            CeroKM: 0,
            Cobertura: dto.coverage ?? '',
            Marca: dto.brand,
            Modelo: dto.model,
            Origen: 'N',
            Uso: 1,
            Valor: '0',
          },
          General: {
            Articulo: 458,
            CantidadCuotas: 1,
            GenerarPresupuesto: true,
            ZonaRiesgoCP: dto.postalCode,
          },
          Autenticacion: auth,
        },
      }),
    )

    const result = response.data
    const quoteNumber: number = Number.parseInt(result?.SDTSrvCotizacionOut?.Presupuesto?.Numero, 10)

    if (quoteNumber) {
      await this.prisma.cotizacion.upsert({
        where: { quoteNumber },
        create: {
          quoteNumber,
          brandCode: dto.brand,
          modelCode: dto.model,
          manufactureYear: dto.manufactureYear,
          postalCode: dto.postalCode,
          result,
          producerId,
          userId,
        },
        update: { result },
      })
    }

    return result
  }
}
