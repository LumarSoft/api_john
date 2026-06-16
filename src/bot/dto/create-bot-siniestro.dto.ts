import { IsDateString, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateBotSiniestroDto {
  @IsInt()
  polizaId: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tipo: string

  @IsDateString()
  fecha: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  descripcion: string
}
