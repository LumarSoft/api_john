import { BadRequestException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { validateSchedule } from '../business-hours/schedule'
import { serializeStaffNames } from '../common/staff-names'
import { AssistantSetupDto } from './dto/assistant-setup.dto'

export type AssistantSetupData = Pick<
  Prisma.PhoneNumberUncheckedCreateInput,
  'botName' | 'staffNames' | 'businessHours' | 'botProfile'
>

/**
 * The number's own assistant as the panel sends it when the number is added:
 * only the fields present, so a reconnect without them changes nothing. An
 * empty value sent on purpose clears the field (the organization's applies).
 */
export function assistantSetupData(dto: AssistantSetupDto): AssistantSetupData {
  const data: AssistantSetupData = {}
  if (dto.botName !== undefined) data.botName = dto.botName.trim() || null
  if (dto.staffNames !== undefined) data.staffNames = serializeStaffNames(dto.staffNames)
  if (dto.businessHours !== undefined) {
    data.businessHours = validateSchedule(dto.businessHours) as unknown as Prisma.InputJsonValue
  }
  const profile: Record<string, string> = {}
  if (dto.presentationName !== undefined) {
    const name = dto.presentationName.trim()
    if (name.length > 120) throw new BadRequestException('presentationName is too long')
    if (name) Object.assign(profile, { orgName: name, orgLegalName: name, orgShortName: name })
  }
  if (dto.transferAlias !== undefined) {
    const alias = dto.transferAlias.trim()
    if (alias) profile.transferAlias = alias
  }
  if (dto.presentationName !== undefined || dto.transferAlias !== undefined) {
    data.botProfile = Object.keys(profile).length ? (profile as Prisma.InputJsonObject) : Prisma.DbNull
  }
  return data
}
