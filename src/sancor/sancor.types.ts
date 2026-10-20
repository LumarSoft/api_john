// Shapes of the Sancor Seguros APIs (IBM API Connect, docs/sancor/specs).
// Only the fields the API reads are typed; Sancor sends more.

// Every Sancor response carries this envelope next to the data.
export interface SancorMessage {
  status?: string
  code?: string
  text?: string
  help?: string
}

export interface SancorTokenResponse {
  access_token: string
  id_token?: string
  scope?: string
  expires_in?: number | string
  token_type?: string
}

// GET /policies — every filter is optional, Sancor answers 400 on combinations it does not support.
export interface SancorPolicyFilters {
  identificationNumber?: number
  cuit?: number
  licensePlate?: string
  officialNumber?: number
  referenceNumber?: number
  branchCode?: number
  isVigent?: boolean
}

export interface SancorPolicy {
  referenceNumber?: string
  certificateNumber?: string
  certificateId?: string
  branchCode?: string
  branchName?: string
  policyTypeName?: string
  isVigent?: string
  policyGroupTypeCode?: string
  policyGroupTypeName?: string
  startDate?: string
  endDate?: string
}

// reportName values accepted by POST /policies/document/file/get, as the spec lists them.
export const SANCOR_REPORT_NAMES = [
  'Carátula',
  'NuevaFacturaCuota',
  'NuevaFactura',
  'Mercosur',
  'ConstanciaDeCoberturaPE',
  'ConstanciaPolizaArgentina',
  'Tarjetasplásticas',
  'CertificadoIncorporación',
  'MercosurPolizaElectronica',
  'ConstanciaCoberturaRC',
  'TarjetaAutomotorPolizaElectronica',
  'CaratulaAnulacionDePoliza',
  'Factura',
  'CertificadoPago',
  'CertificadoSOA',
  'DocumentoUnificadoAPF',
] as const

export type SancorReportName = (typeof SANCOR_REPORT_NAMES)[number]

export interface SancorDocumentRequest {
  branchCode: number
  reportName: SancorReportName
  officialNumber?: string
  referenceNumber?: string
  certificateNumber?: number
  postalCode?: number
  policyMovNumber?: number
  contractNumber?: string
  identificationNumber?: number
  engineNumber?: string
  quoteNumber?: string
}

export interface SancorFile {
  reportName?: string
  urlFile?: string
  // Base64 content, when Sancor sends the file inline instead of a link.
  fileAttachment?: string
}

export interface SancorClaimListFilters {
  branchCode: number
  // YYYY-MM-DD, at most one month back.
  claimOccurredDateSince?: string
  claimReportedDateSince?: string
}

export interface SancorClaim {
  claimDescription?: string
  claimCauseCode?: number
  claimCauseName?: string
  statusConcept?: string
  rejectMark?: boolean
  claimDate?: { claimOccurredDate?: string; claimReportedDate?: string; claimClosingDate?: string }
  branch?: { branchCode?: number; branchName?: string; productName?: string }
  status?: {
    claimStatusCode?: string
    claimStatusName?: string
    claimSubStatusCode?: string
    claimSubStatusName?: string
  }
  insured?: { registeredName?: string }
  [field: string]: unknown
}

export type SancorVehicleKind = 'automotive' | 'motorcycle'

// Body of the auto and moto quotations, in the auto spelling. The moto API takes
// the same fields unwrapped and spells the assistance block "assistence".
export interface SancorVehicleQuotation {
  relationQuotationCode?: number
  person: {
    identificationNumber?: number
    // 'D' DNI, 'C' LC, 'L' LE, 'I' CI, 'J' CUIT
    identificationType: string
    isJuridicPerson: boolean
  }
  coverModuleCodes?: Array<{ offeringCode: number }>
  currencyCode: number
  discountCustomizations?: Array<{ discountCode: number; percentage: number }>
  policyPeriodStartEffectiveDate: string
  policyPeriodEndEffectiveDate?: string
  coveredItemInsuredSum?: number
  // IVA condition: 1 Responsable Inscripto … 4 Consumidor Final …
  conditionCode?: number
  respectClientIvaCondition?: boolean
  // Producer and organizer default to SANCOR_PRODUCER_CODE / SANCOR_ORGANIZER_CODE.
  intermediary?: {
    prodProducerCode?: number
    upperProducerCode?: number
    statisticCode?: number
    sellerNumber?: number
  }
  // 1 annual, 2 half-yearly, 3 quarterly
  policyVigencyCode: number
  // 5 monthly, 7 installments
  policyPaymentPeriodicityCode: number
  policyQuotas: number
  productCode: number
  zone: { postalCode: number; cityCode?: number }
  vehicle: {
    // InfoAuto CODIA (InfoMoto for motorcycles).
    vehicleCode: string
    vehicleYear: number
    yearSuggestedValue: number
    // 2 particular, 4 particular y/o comercial, 7 transporte general rutero
    vehicleUseTypeCode: number
    vehicleTrackingEquipment: boolean
    gncInformation?: { hasGNC?: boolean; accesoryInsuredSum?: number }
    assistance?: { assistance: string; assistanceProvider: string }
    hasAuxiliaryTires?: boolean
    zeroKM?: boolean
    zeroKMPurchaseDate?: string
    vehicleClassCode?: number
  }
  driversUnder25?: boolean
  anualKM?: boolean
  garageParking?: boolean
}

export interface SancorQuotationPlan {
  module?: {
    coverageCode?: number
    coverageName?: string
    coverageAbbreviatedName?: string
    message?: string
    observations?: string
  }
  // Premium for the whole term and per month/installment.
  premium?: number
  quotaPremiumMonthly?: number
  success?: boolean
  validationResults?: string
  vehicleInsuredSum?: number
  premiumTotals?: { quotaAmount?: number; quotationPremium?: number }
  [field: string]: unknown
}

export interface SancorQuotation {
  quotationCode?: number
  relationQuotationCode?: number
  plans: SancorQuotationPlan[]
}
