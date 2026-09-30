import { IsBoolean } from 'class-validator'

export class SetBotStatusDto {
  @IsBoolean()
  botEnabled: boolean
}
