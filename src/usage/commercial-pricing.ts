import { ConfigService } from '@nestjs/config'

/** How many plan messages a template consumes from `templateWeightFrom` on (an in-conversation reply consumes 1). */
export const TEMPLATE_WEIGHT = 2

/**
 * Meta pricing categories that are in-conversation replies, not templates: `service` (a reply inside the 24-hour
 * window) and `referral_conversion` (a reply inside the free window an ad opens). Every other category (utility,
 * marketing, authentication…) is a template the business starts.
 */
const REPLY_CATEGORIES = new Set(['service', 'referral_conversion'])

/**
 * What billing needs besides the catalog (MessagePlan rows, edited by the owner).
 * `blockMessages` is the step a busy month climbs past the largest plan; it is
 * priced at the largest plan's price per message. New accounts (organizations
 * created from `trialFrom` on) start each new number on the trial plan. Templates
 * delivered from `templateWeightFrom` on consume TEMPLATE_WEIGHT messages of the plan.
 */
export interface CommercialPricing {
  blockMessages: number
  trialFrom: Date
  templateWeightFrom: Date
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
  const templateWeightFrom = argentinaDate(config.get<string>('COMMERCIAL_TEMPLATE_WEIGHT_FROM') || '2026-12-01')
  if (
    !Number.isInteger(blockMessages) ||
    blockMessages <= 0 ||
    Number.isNaN(trialFrom.getTime()) ||
    Number.isNaN(templateWeightFrom.getTime())
  )
    throw new Error('Invalid commercial billing configuration')
  return { blockMessages, trialFrom, templateWeightFrom }
}

/** Whether an organization's new numbers start on the trial plan: only accounts created from the trial date on. */
export function startsOnTrial(pricing: CommercialPricing, organizationCreatedAt: Date): boolean {
  return organizationCreatedAt >= pricing.trialFrom
}

/** Whether Meta priced a delivered message as a template (anything but an in-conversation reply). */
export function isTemplateCategory(category: string): boolean {
  return !REPLY_CATEGORIES.has(category.trim().toLowerCase())
}

/**
 * The plan messages a delivered message consumes on top of its own one: TEMPLATE_WEIGHT − 1 for a template delivered
 * from `templateWeightFrom` on, 0 otherwise (a reply, or any message before that date).
 */
export function templateExtraMessages(pricing: CommercialPricing, category: string, deliveredAt: Date): number {
  return isTemplateCategory(category) && deliveredAt >= pricing.templateWeightFrom ? TEMPLATE_WEIGHT - 1 : 0
}
