/**
 * Plan prices are the OWNER's (Lumar's) business: an organization sees its plans by name and messages, never in USD.
 * The plan as is for the owner; without `priceUsd` for anyone else.
 */
export function pricedFor<T extends { priceUsd: number }>(plan: T, owner: boolean): T | Omit<T, 'priceUsd'>
export function pricedFor<T extends { priceUsd: number }>(
  plan: T | null,
  owner: boolean,
): T | Omit<T, 'priceUsd'> | null
export function pricedFor<T extends { priceUsd: number }>(plan: T | null, owner: boolean) {
  if (!plan || owner) return plan
  const { priceUsd: _priceUsd, ...rest } = plan
  return rest
}
