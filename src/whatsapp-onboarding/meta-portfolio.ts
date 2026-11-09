/** The Meta portfolio behind a number's WhatsApp account, as WhatsappPortfolioService stored it. */
export function metaPortfolio(
  waba: {
    wabaName: string | null
    businessId: string | null
    businessName: string | null
    businessVerification: string | null
    portfolioCheckedAt: Date | null
  } | null,
) {
  if (!waba?.portfolioCheckedAt) return null
  return {
    wabaName: waba.wabaName,
    businessId: waba.businessId,
    businessName: waba.businessName,
    verification: waba.businessVerification,
    checkedAt: waba.portfolioCheckedAt,
  }
}
