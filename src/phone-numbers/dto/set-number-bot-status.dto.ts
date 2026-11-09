import { IsBoolean } from 'class-validator'

export class SetNumberBotStatusDto {
  @IsBoolean()
  botEnabled: boolean
}
