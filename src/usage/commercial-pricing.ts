import { ConfigService } from '@nestjs/config'

/**
 * What billing needs besides the catalog (MessagePlan rows, edited by the owner).
 * `blockMessages` is the step a busy month climbs past the largest plan; it is
 * priced at the largest plan's price per message. New accounts (organizations
 * created from `trialFrom` on) start each new number on the trial plan.
 */
export interface CommercialPricing {
  blockMessages: number
  trialFrom: Date
}

export function readCommercialPricing(config: ConfigService): CommercialPricing {
  // COMMERCIAL_TOKEN_BLOCK_SIZE is the variable's name from the token billing; it still sets the block.
  const blockMessages = Number(
    config.get('COMMERCIAL_BLOCK_MESSAGES') ?? config.get('COMMERCIAL_TOKEN_BLOCK_SIZE') ?? 1000,
  )
  const trialFrom = new Date(config.get('COMMERCIAL_TRIAL_FROM') ?? '2026-10-29T00:00:00-03:00')
  if (!Number.isInteger(blockMessages) || blockMessages <= 0 || Number.isNaN(trialFrom.getTime()))
    throw new Error('Invalid commercial billing configuration')
  return { blockMessages, trialFrom }
}

/** Whether an organization's new numbers start on the trial plan: only accounts created from the trial date on. */
export function startsOnTrial(pricing: CommercialPricing, organizationCreatedAt: Date): boolean {
  return organizationCreatedAt >= pricing.trialFrom
}
