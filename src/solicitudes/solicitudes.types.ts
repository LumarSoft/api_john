// Products whose quote is NOT instant (auto/moto): they create a ContactLead.
// `bici` covers bicycles and monopatines (subtype carried in payload).
export const LEAD_PRODUCT_TYPES = ['bici', 'comercio', 'praxis', 'personas', 'bolso', 'hogar'] as const
export type LeadProductType = (typeof LEAD_PRODUCT_TYPES)[number]

// Products with admin-configured fixed-price plans.
export const FIXED_PRODUCT_TYPES = ['bolso', 'hogar'] as const
export type FixedProductType = (typeof FIXED_PRODUCT_TYPES)[number]

// All product types that can appear in the unified "Solicitudes" panel, including
// the instant auto/moto coverage requests (kind = "cotizacion").
export const ALL_PRODUCT_TYPES = ['auto', 'moto', ...LEAD_PRODUCT_TYPES] as const

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'CLOSED'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_KINDS = ['lead', 'cotizacion'] as const
export type LeadKind = (typeof LEAD_KINDS)[number]

// Normalized row for the unified admin list — both ContactLead and the auto/moto
// Solicitud collapse into this shape so the panel renders a single stream.
export interface SolicitudListItem {
  id: number
  kind: LeadKind
  productType: string
  contactName: string
  phone: string
  email: string | null
  summary: string | null
  channel: string | null
  status: string
  createdAt: Date
}
