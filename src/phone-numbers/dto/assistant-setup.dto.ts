import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * The assistant a number starts with, asked by the panel together with the
 * branch name before the number is connected or registered, so a new branch
 * never greets as another office (Roldán greeted as the head office, 6/11).
 * Optional here: a reconnect that sends none keeps what the number had.
 */
export class AssistantSetupDto {
  // How the bot is called on this number ("Nico").
  @IsOptional()
  @IsString()
  @MaxLength(60)
  botName?: string

  // Whose assistant the bot says it is ("Vanesa Aguilar"): the number's
  // orgName, orgLegalName and orgShortName, all three, so nothing of the
  // organization's name shows through.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  presentationName?: string

  // The people of this office a customer may write to by name.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  staffNames?: string[]

  // Weekly schedule { mon: [{from,to}], ..., sun: [] }, validated in the service.
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>
}
