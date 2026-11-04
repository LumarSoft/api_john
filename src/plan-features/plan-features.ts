import { BadRequestException } from '@nestjs/common'

/**
 * The panel functions a message plan can include or leave out. The OWNER turns
 * them on and off for each plan in Facturación → Planes. A plan that never
 * listed a function gets the function's `defaultOn`: the notices the office
 * already used before plans had functions start on; everything added since
 * (2026-11-04) starts off until the owner turns it on, and so must any new one.
 */
export const PLAN_FEATURES = [
  {
    key: 'rejection_notices',
    defaultOn: true,
    label: 'Avisos de rechazos de pago',
    description: 'Enviar por WhatsApp los avisos del Excel de rechazos de débito.',
  },
  {
    key: 'expiry_notices',
    defaultOn: true,
    label: 'Avisos de pólizas vencidas',
    description: 'Enviar por WhatsApp el aviso a los asegurados con la póliza vencida.',
  },
  {
    key: 'ai_assistant',
    defaultOn: false,
    label: 'Asistente con IA',
    description: 'Preguntarle a la IA por clientes, pólizas, cuotas y vencimientos desde el panel.',
  },
  {
    key: 'campaign_coverage_upgrade',
    defaultOn: false,
    label: 'Campaña: mejora de coberturas',
    description: 'Ofrecer una cobertura más completa a quien tiene una básica.',
  },
  {
    key: 'campaign_quote_followup',
    defaultOn: false,
    label: 'Campaña: cotizaciones sin cerrar',
    description: 'Retomar las cotizaciones del bot que no terminaron en póliza.',
  },
  {
    key: 'campaign_renewal',
    defaultOn: false,
    label: 'Campaña: renovaciones',
    description: 'Escribir antes de que venza la póliza.',
  },
  {
    key: 'campaign_winback',
    defaultOn: false,
    label: 'Campaña: bajas y anulaciones',
    description: 'Ofrecer una alternativa a quien se dio de baja.',
  },
  {
    key: 'campaign_cross_sell',
    defaultOn: false,
    label: 'Campaña: venta cruzada',
    description: 'Ofrecer hogar y otros seguros a quien tiene solo el del vehículo.',
  },
] as const

export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]['key']

/** Every function of the catalog and whether a plan includes it. */
export type PlanFeatures = Record<PlanFeatureKey, boolean>

/** What the API answers when a function the organization's plans leave out is used. */
export const FEATURE_NOT_IN_PLAN: Record<PlanFeatureKey, string> = {
  rejection_notices:
    'El plan de tus números no incluye el envío de avisos de rechazos. Se puede cambiar en Facturación.',
  expiry_notices:
    'El plan de tus números no incluye el envío de avisos de pólizas vencidas. Se puede cambiar en Facturación.',
  ai_assistant: 'El plan de tus números no incluye el asistente con IA. Se puede cambiar en Facturación.',
  campaign_coverage_upgrade: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_quote_followup: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_renewal: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_winback: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_cross_sell: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
}

const KEYS = new Set<string>(PLAN_FEATURES.map(f => f.key))

/** A plan's stored functions as the full catalog: what it never set takes the function's default. */
export function featuresOf(stored: unknown): PlanFeatures {
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  return Object.fromEntries(
    PLAN_FEATURES.map(f => [f.key, typeof map[f.key] === 'boolean' ? map[f.key] : f.defaultOn]),
  ) as PlanFeatures
}

/** Every function on: the owner. */
export function allFeatures(): PlanFeatures {
  return Object.fromEntries(PLAN_FEATURES.map(f => [f.key, true])) as PlanFeatures
}

/** What a plan that never set anything has. */
export function defaultFeatures(): PlanFeatures {
  return featuresOf(null)
}

/** The roles a function can be turned on or off for, besides the plan (the owner always has everything). */
export const FEATURE_ROLES = ['ADMIN', 'SUPERADMIN'] as const
export type FeatureRole = (typeof FEATURE_ROLES)[number]
export type FeatureRoles = Record<FeatureRole, boolean>

/** What the API answers when the user's role has a function turned off. */
export const FEATURE_NOT_FOR_ROLE =
  'Tu usuario no tiene habilitada esta función. Lo define el soporte de la plataforma.'

/** The plan's functions after the owner's change; rejects a function the catalog does not have. */
export function withChanges(stored: unknown, changes: Record<string, unknown>): PlanFeatures {
  for (const [key, value] of Object.entries(changes)) {
    if (!KEYS.has(key)) throw new BadRequestException(`La función ${key} no existe.`)
    if (typeof value !== 'boolean')
      throw new BadRequestException(`La función ${key} se prende o se apaga (true o false).`)
  }
  return { ...featuresOf(stored), ...(changes as Partial<PlanFeatures>) }
}

/** The functions of several plans together: one plan including a function is enough. */
export function unionOf(plans: PlanFeatures[]): PlanFeatures {
  if (!plans.length) return defaultFeatures()
  return Object.fromEntries(PLAN_FEATURES.map(f => [f.key, plans.some(p => p[f.key])])) as PlanFeatures
}
