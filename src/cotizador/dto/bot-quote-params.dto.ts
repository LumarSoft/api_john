import { IsString, MaxLength } from 'class-validator'
import { VehicleTypeParamDto } from '../../infoauto/dto/vehicle-type-param.dto'

export class BotQuoteParamsDto extends VehicleTypeParamDto {
  /** Meta phone_number_id the chat came through. */
  @IsString()
  @MaxLength(64)
  phoneNumberId: string
}
