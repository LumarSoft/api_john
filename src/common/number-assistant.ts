import { overlayBotProfile, type BotProfile } from './bot-profile'

/** Assistant settings as an organization stores them and, as overrides, each of its numbers. */
export interface AssistantSettings {
  botName: string | null
  /** Comma-separated, see staff-names.ts. */
  staffNames: string | null
  businessHours: unknown
  botProfile: unknown
}

export interface EffectiveAssistant {
  botName: string | null
  staffNames: string | null
  businessHours: unknown
  botProfile: BotProfile | null
}

/**
 * What a number's assistant uses: the number's own value for every setting it
 * has and its organization's for the rest. Without a number (a chat that came
 * through no registered line) it is the organization's.
 */
export function effectiveAssistant(
  organization: AssistantSettings,
  number: AssistantSettings | null,
): EffectiveAssistant {
  return {
    botName: number?.botName ?? organization.botName,
    staffNames: number?.staffNames ?? organization.staffNames,
    businessHours: number?.businessHours ?? organization.businessHours,
    botProfile: overlayBotProfile(organization.botProfile, number?.botProfile ?? null),
  }
}
