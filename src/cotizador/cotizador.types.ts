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

export interface QuoteAutoResult {
  quoteNumber: string | null
  validUntil: string | null
  vehicleValue: string | null
  coverages: QuoteCoverage[]
  messages: string[]
}

export interface CoverageRequestResult {
  quoteNumber: string
  coverage: string
  startDate: string
}
