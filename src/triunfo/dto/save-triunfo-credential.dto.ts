import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

export class SaveTriunfoCredentialDto {
  /** Producer code Triunfo issued the web-service user for ("Codigo" of getTokenRest). */
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'productor must be the numeric Triunfo producer code' })
  productor: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string
}
