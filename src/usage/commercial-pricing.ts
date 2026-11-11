import { ConfigService } from '@nestjs/config'

/** How many plan messages a campaign (marketing) message consumes from `campaignWeightFrom` on (any other, 1). */
export const CAMPAIGN_WEIGHT = 2

/**
 * Meta pricing categories that are in-conversation replies, not templates: `service` (a reply inside the 24-hour
 * window) and `referral_conversion` (a reply inside the free window an ad opens). Every other category (utility,
 * marketing, authentication…) is a template the business starts.
 */
const REPLY_CATEGORIES = new Set(['service', 'referral_conversion'])

/**
 * Meta pricing categories of a campaign: a marketing template (`marketing_lite` when it goes out through Marketing
 * Messages Lite). The only messages that weigh more on the plan: replies, utility templates (rejection and expiry
 * notices, quote follow-ups) and authentication consume 1.
 */
export const CAMPAIGN_CATEGORIES = ['marketing', 'marketing_lite']
const CAMPAIGN_CATEGORY_SET = new Set(CAMPAIGN_CATEGORIES)

/**
 * What billing needs besides the catalog (MessagePlan rows, edited by the owner).
 * `blockMessages` is the step a busy month climbs past the largest plan; it is
 * priced at the largest plan's price per message. New accounts (organizations
 * created from `trialFrom` on) start each new number on the trial plan. Campaign
 * (marketing) messages delivered from `campaignWeightFrom` on consume CAMPAIGN_WEIGHT
 * messages of the plan.
 */
export interface CommercialPricing {
  blockMessages: number
  trialFrom: Date
  /** COMMERCIAL_TEMPLATE_WEIGHT_FROM (the variable keeps its first name). */
  campaignWeightFrom: Date
}

/** A date setting: "YYYY-MM-DD" is midnight in Argentina (UTC-3 all year); anything else is parsed as is. */
function argentinaDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00-03:00` : value)
}

export function readCommercialPricing(config: ConfigService): CommercialPricing {
  // COMMERCIAL_TOKEN_BLOCK_SIZE is the variable's name from the token billing; it still sets the block.
  const blockMessages = Number(
    config.get('COMMERCIAL_BLOCK_MESSAGES') ?? config.get('COMMERCIAL_TOKEN_BLOCK_SIZE') ?? 1000,
  )
  const trialFrom = new Date(config.get('COMMERCIAL_TRIAL_FROM') ?? '2026-10-29T00:00:00-03:00')
  const campaignWeightFrom = argentinaDate(config.get<string>('COMMERCIAL_TEMPLATE_WEIGHT_FROM') || '2026-12-01')
  if (
    !Number.isInteger(blockMessages) ||
    blockMessages <= 0 ||
    Number.isNaN(trialFrom.getTime()) ||
    Number.isNaN(campaignWeightFrom.getTime())
  )
    throw new Error('Invalid commercial billing configuration')
  return { blockMessages, trialFrom, campaignWeightFrom }
}

/** Whether an organization's new numbers start on the trial plan: only accounts created from the trial date on. */
export function startsOnTrial(pricing: CommercialPricing, organizationCreatedAt: Date): boolean {
  return organizationCreatedAt >= pricing.trialFrom
}

/** Whether Meta priced a delivered message as a template (anything but an in-conversation reply). */
export function isTemplateCategory(category: string): boolean {
  return !REPLY_CATEGORIES.has(category.trim().toLowerCase())
}

/** Whether Meta priced a delivered message as a campaign (marketing). */
export function isCampaignCategory(category: string): boolean {
  return CAMPAIGN_CATEGORY_SET.has(category.trim().toLowerCase())
}

/**
 * The plan messages a delivered message consumes on top of its own one: CAMPAIGN_WEIGHT − 1 for a campaign
 * (marketing) message delivered from `campaignWeightFrom` on, 0 otherwise (a reply, a utility or authentication
 * template, or any message before that date).
 */
export function campaignExtraMessages(pricing: CommercialPricing, category: string, deliveredAt: Date): number {
  return isCampaignCategory(category) && deliveredAt >= pricing.campaignWeightFrom ? CAMPAIGN_WEIGHT - 1 : 0
}
