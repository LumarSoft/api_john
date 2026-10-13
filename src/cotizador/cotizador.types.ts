export interface QuotePaymentOption {
  code: string
  name: string
  premium: number
  installmentValue: number
  installments: number
}

export interface QuoteCoverage {
  code: string
  paymentOptions: QuotePaymentOption[]
}

/** A quoted coverage plus how it must be shown, resolved from CoverageSetting. */
export interface DisplayedQuoteCoverage extends QuoteCoverage {
  name: string
  tagline: string | null
  benefits: string[]
  /** What it does not include, so the client can tell similar coverages apart. */
  exclusions: string[]
  highlighted: boolean
}

/** The Triunfo response, cleaned up but before the display rules are applied. */
export interface NormalizedQuote {
  quoteNumber: string | null
  validUntil: string | null
  vehicleValue: string | null
  coverages: QuoteCoverage[]
  messages: string[]
}

/** What the web and the bot receive: only the coverages meant to be shown. */
export interface QuoteAutoResult extends Omit<NormalizedQuote, 'coverages'> {
  coverages: DisplayedQuoteCoverage[]
  /**
   * Triunfo could not value the vehicle (ValorVehiculo 0) and so priced only
   * Responsabilidad Civil: every other coverage exists but came back invalid.
   * Not a final answer — the office has to quote it.
   */
  valuationMissing: boolean
}

export interface CoverageRequestResult {
  quoteNumber: string
  coverage: string
  startDate: string
}
