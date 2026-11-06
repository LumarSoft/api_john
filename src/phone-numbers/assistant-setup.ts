import { Prisma } from 'generated/prisma/client'
import { parseSchedule, validateSchedule } from '../business-hours/schedule'
import { mergeBotProfile, parseBotProfile, type BotProfile } from '../common/bot-profile'
import { effectiveAssistant, type AssistantSettings } from '../common/number-assistant'
import { parseStaffNames, serializeStaffNames } from '../common/staff-names'
import { AssistantSetupDto } from './dto/assistant-setup.dto'

export type AssistantSetupData = Pick<
  Prisma.PhoneNumberUncheckedCreateInput,
  'botName' | 'staffNames' | 'businessHours' | 'botProfile'
>

/** The stored settings an assistant is read from, on the organization and on each number. */
export const ASSISTANT_SETTINGS_SELECT = {
  botName: true,
  staffNames: true,
  businessHours: true,
  botProfile: true,
} as const

/** What a number answers with before the setup is applied. */
export interface CurrentAssistant {
  /** The organization's settings and its name, which the bot introduces when it has no name of its own. */
  organization: AssistantSettings & { name: string }
  /** The number's own settings; null for a number that does not exist yet. */
  number: AssistantSettings | null
}

const ACCOUNT_FIELDS = ['transferAlias', 'transferCbu', 'transferHolder', 'transferBank'] as const

type ProfileChanges = Partial<Record<keyof BotProfile, string>>

/** Bank aliases ignore case. */
const sameAlias = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** Whether the panel sent any of the assistant fields. */
export const sendsAssistantSetup = (dto: AssistantSetupDto): boolean =>
  [dto.botName, dto.presentationName, dto.transferAlias, dto.staffNames, dto.businessHours].some(v => v !== undefined)

/** Rejects hours that cannot be stored, before Meta's 30-second code is spent. */
export function validateAssistantSetup(dto: AssistantSetupDto): void {
  if (dto.businessHours !== undefined) validateSchedule(dto.businessHours)
}

function profileChanges(dto: AssistantSetupDto, current: CurrentAssistant, now: BotProfile | null): ProfileChanges {
  const changes: ProfileChanges = {}
  if (dto.presentationName !== undefined) {
    const name = dto.presentationName.trim()
    if (name !== (now?.orgName ?? current.organization.name)) {
      Object.assign(changes, { orgName: name, orgLegalName: name, orgShortName: name })
    }
  }
  if (dto.transferAlias !== undefined) {
    const alias = dto.transferAlias.trim()
    const organizationAlias = parseBotProfile(current.organization.botProfile).transferAlias
    if (alias && sameAlias(alias, organizationAlias) && !sameAlias(alias, now?.transferAlias)) {
      // The organization's alias: the number goes back to the organization's whole account (CBU, holder, bank).
      for (const field of ACCOUNT_FIELDS) changes[field] = ''
    } else if (!sameAlias(alias, now?.transferAlias)) {
      changes.transferAlias = alias
    }
  }
  return changes
}

/**
 * The number's own assistant as the panel sends it when the number is
 * connected, reconnected or registered. Only what changes is written:
 *
 *  - a field equal to what the number already uses is left alone, so a
 *    reconnect that sends back the prefilled form changes nothing, and a value
 *    equal to the organization's keeps following the organization (the same
 *    alias keeps the organization's whole account, CBU and holder included);
 *  - the presentation and the alias are merged into the number's own profile:
 *    its CBU, holder, bank, lines and closing note are never dropped;
 *  - a field sent empty on purpose clears the number's own value, so the
 *    organization's applies again.
 */
export function assistantSetupData(dto: AssistantSetupDto, current: CurrentAssistant): AssistantSetupData {
  const now = effectiveAssistant(current.organization, current.number)
  const data: AssistantSetupData = {}

  if (dto.botName !== undefined) {
    const botName = dto.botName.trim() || null
    if (botName !== (now.botName ?? null)) data.botName = botName
  }
  if (dto.staffNames !== undefined) {
    const staffNames = serializeStaffNames(dto.staffNames)
    if (staffNames !== serializeStaffNames(parseStaffNames(now.staffNames))) data.staffNames = staffNames
  }
  if (dto.businessHours !== undefined) {
    const hours = validateSchedule(dto.businessHours)
    if (JSON.stringify(hours) !== JSON.stringify(parseSchedule(now.businessHours))) {
      data.businessHours = hours as unknown as Prisma.InputJsonValue
    }
  }
  const changes = profileChanges(dto, current, now.botProfile)
  if (Object.keys(changes).length) {
    const own = Object.entries(mergeBotProfile(current.number?.botProfile ?? null, changes)).filter(
      ([, v]) => v != null,
    )
    data.botProfile = own.length ? (Object.fromEntries(own) as Prisma.InputJsonObject) : Prisma.DbNull
  }
  return data
}
