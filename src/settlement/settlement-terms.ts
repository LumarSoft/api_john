import { ConfigService } from '@nestjs/config'

/**
 * How the platform's profit is split with its commercial partner. Lumarsoft charges a service cost for every plan
 * message a number consumes (a template that counts twice costs twice); what the month billed minus that cost is the
 * remainder, and the partner gets `partnerShare` of it (Lumarsoft the rest). Set by env, never in the panel's copy.
 */
export interface SettlementTerms {
  /** PARTNER_COST_PER_MESSAGE_USD: Lumarsoft's cost per consumed message. */
  costPerMessageUsd: number
  /** PARTNER_PROFIT_SHARE: the partner's share of the remainder, 0–1. */
  partnerShare: number
}

/** A number's month, split. */
export interface Settlement {
  costPerMessageUsd: number
  partnerShare: number
  /** consumed messages × cost per message. */
  serviceCostUsd: number
  /** billed − service cost; negative when the month billed less than it cost (a trial bills 0). */
  remainderUsd: number
  partnerShareUsd: number
  /** Lumarsoft's share of the remainder (the remainder minus the partner's, so the two always add up). */
  ownerShareUsd: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function readSettlementTerms(config: ConfigService): SettlementTerms {
  const costPerMessageUsd = Number(config.get<string>('PARTNER_COST_PER_MESSAGE_USD') || 0.04)
  const partnerShare = Number(config.get<string>('PARTNER_PROFIT_SHARE') || 0.5)
  if (!Number.isFinite(costPerMessageUsd) || costPerMessageUsd < 0 || !(partnerShare >= 0 && partnerShare <= 1))
    throw new Error('Invalid partner settlement configuration')
  return { costPerMessageUsd, partnerShare }
}

/** Splits a number's month: Lumarsoft's cost first, then the remainder between the partners. */
export function settle(billedUsd: number, consumedMessages: number, terms: SettlementTerms): Settlement {
  const serviceCostUsd = round2(consumedMessages * terms.costPerMessageUsd)
  const remainderUsd = round2(billedUsd - serviceCostUsd)
  const partnerShareUsd = round2(remainderUsd * terms.partnerShare)
  return {
    costPerMessageUsd: terms.costPerMessageUsd,
    partnerShare: terms.partnerShare,
    serviceCostUsd,
    remainderUsd,
    partnerShareUsd,
    ownerShareUsd: round2(remainderUsd - partnerShareUsd),
  }
}
