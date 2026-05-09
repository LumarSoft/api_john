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

  async cotizarAuto(dto: CotizarAutoDto, userId: number | null) {
    const auth = await this.triunfo.getAuth()

    const response = await firstValueFrom(
      this.httpService.post(`${this.triunfo.baseUrlSip}/RESTCotizadorAutV2`, {
        SDTSrvCotizacionIn: {
          Automotor: {
            Accesorios: [],
            Adicionales: [],
            AnioFabricacion: dto.anioFabricacion,
            Bonificacion: '0',
            Catalogo: 'IA',
            CeroKM: 0,
            Cobertura: '',
            Marca: dto.marca,
            Modelo: dto.modelo,
            Origen: 'N',
            Uso: 1,
            Valor: '0',
          },
          General: {
            Articulo: 458,
            CantidadCuotas: 1,
            GenerarPresupuesto: true,
            ZonaRiesgoCP: dto.codigoPostal,
          },
          Autenticacion: auth,
        },
      }),
    )

    const resultado = response.data
    const presupuestoNro: number = resultado?.SDTSrvCotizacionOut?.PresupuestoNro

    if (presupuestoNro) {
      await this.prisma.cotizacion.upsert({
        where: { presupuestoNro },
        create: {
          presupuestoNro,
          marcaCodigo: dto.marca,
          modeloCodigo: dto.modelo,
          anioFabricacion: dto.anioFabricacion,
          codigoPostal: dto.codigoPostal,
          resultado,
          userId,
        },
        update: { resultado },
      })
    }

    return resultado
  }
}
