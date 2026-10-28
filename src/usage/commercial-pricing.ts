import { ConfigService } from '@nestjs/config'

/**
 * The platform's token pricing: every token (message sent) costs the same,
 * whatever the plan size; an organization's catalog only fractions it.
 * `blockTokens` is the step past the largest plan. New accounts get
 * `trialTokens` free in a number's first month of service.
 */
export interface CommercialPricing {
  unitPriceUsd: number
  blockTokens: number
  /** A block at the unit price, for the owner's report. */
  blockPriceUsd: number
  trialTokens: number
  /** Organizations created from this moment on are "new accounts" with a trial. */
  trialFrom: Date
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function readCommercialPricing(config: ConfigService): CommercialPricing {
  const unitPriceUsd = Number(config.get('COMMERCIAL_TOKEN_PRICE_USD') ?? 0.05)
  const blockTokens = Number(config.get('COMMERCIAL_TOKEN_BLOCK_SIZE') ?? 1000)
  const trialTokens = Number(config.get('COMMERCIAL_TRIAL_TOKENS') ?? 100)
  const trialFrom = new Date(config.get('COMMERCIAL_TRIAL_FROM') ?? '2026-10-29T00:00:00-03:00')
  if (
    [unitPriceUsd, blockTokens].some(value => !Number.isFinite(value) || value <= 0) ||
    !Number.isInteger(blockTokens) ||
    !Number.isInteger(trialTokens) ||
    trialTokens < 0 ||
    Number.isNaN(trialFrom.getTime())
  )
    throw new Error('Invalid commercial billing configuration')
  return { unitPriceUsd, blockTokens, blockPriceUsd: round2(unitPriceUsd * blockTokens), trialTokens, trialFrom }
}

/** The free tokens a number gets in its first month: only the numbers of accounts created from the trial date on. */
export function trialTokensFor(pricing: CommercialPricing, organizationCreatedAt: Date): number {
  return organizationCreatedAt >= pricing.trialFrom ? pricing.trialTokens : 0
}
