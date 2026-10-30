import type { BilledPlan, CatalogPlan } from './usage.service'

/*
 * The billing fields under their old "tokens" names, for the panel that still runs in front_John while it and
 * Polisend's panel live side by side (PLAN-SAAS.md, semana de prueba). They repeat the new values, nothing new reads
 * them. Delete this file and its uses once front_John redirects /admin to Polisend.
 */

/** A billed plan plus the names front_John's panel reads. */
export function withLegacyPlan(plan: BilledPlan, blockMessages: number) {
  return {
    ...plan,
    includedTokens: plan.includedMessages,
    blocks: Math.max(1, Math.ceil(plan.includedMessages / blockMessages)),
  }
}

/** What one message costs on the largest active paid plan: the old fixed price per token. */
export function legacyUnitPriceUsd(catalog: CatalogPlan[]): number {
  const largest = catalog.filter(p => p.isActive && !p.isTrial).at(-1)
  return largest && largest.messages > 0 ? Math.round((largest.priceUsd / largest.messages) * 10000) / 10000 : 0
}

/** The free messages of the active trial plan (0 without one): the old trial tokens. */
export function legacyTrialTokens(catalog: CatalogPlan[]): number {
  return catalog.find(p => p.isActive && p.isTrial)?.messages ?? 0
}

/** The pricing summary front_John's panel shows the owner. */
export function legacyPricing(catalog: CatalogPlan[], blockMessages: number) {
  const unitPriceUsd = legacyUnitPriceUsd(catalog)
  return {
    unitPriceUsd,
    blockTokens: blockMessages,
    blockPriceUsd: Math.round(unitPriceUsd * blockMessages * 100) / 100,
    trialTokens: legacyTrialTokens(catalog),
  }
}
