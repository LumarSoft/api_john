import { IsInt, IsString, Min, Max } from 'class-validator'

export class CotizarAutoDto {
  @IsString()
  marca: string

  @IsString()
  modelo: string

  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear() + 1)
  anioFabricacion: number

  @IsInt()
  codigoPostal: number
}
