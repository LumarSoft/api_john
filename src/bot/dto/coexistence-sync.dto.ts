import { IsArray, IsString, MinLength } from 'class-validator'

export class CoexistenceHistoryDto {
  @IsString()
  @MinLength(3)
  phoneNumberId: string

  // Payload contents are preserved verbatim in Message.rawData. Meta adds new
  // message types over time, so validating the stable envelope is safer than
  // dropping fields through a rigid nested DTO.
  @IsArray()
  chunks: unknown[]
}

export class CoexistenceContactsDto {
  @IsString()
  @MinLength(3)
  phoneNumberId: string

  @IsArray()
  contacts: unknown[]
}
