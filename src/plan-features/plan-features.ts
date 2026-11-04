import { BadRequestException } from '@nestjs/common'

/**
 * The panel functions a message plan can include or leave out. The OWNER turns
 * them on and off for each plan in Facturación → Planes; a plan that never
 * listed a function includes it, so a new function reaches every plan until
 * someone turns it off.
 */
export const PLAN_FEATURES = [
  {
    key: 'rejection_notices',
    label: 'Avisos de rechazos de pago',
    description: 'Enviar por WhatsApp los avisos del Excel de rechazos de débito.',
  },
  {
    key: 'expiry_notices',
    label: 'Avisos de pólizas vencidas',
    description: 'Enviar por WhatsApp el aviso a los asegurados con la póliza vencida.',
  },
  {
    key: 'internal_chat',
    label: 'Chat interno',
    description: 'Chat entre los usuarios del panel de la organización.',
  },
  {
    key: 'campaign_coverage_upgrade',
    label: 'Campaña: mejora de coberturas',
    description: 'Ofrecer una cobertura más completa a quien tiene una básica.',
  },
  {
    key: 'campaign_quote_followup',
    label: 'Campaña: cotizaciones sin cerrar',
    description: 'Retomar las cotizaciones del bot que no terminaron en póliza.',
  },
  {
    key: 'campaign_renewal',
    label: 'Campaña: renovaciones',
    description: 'Escribir antes de que venza la póliza.',
  },
  {
    key: 'campaign_winback',
    label: 'Campaña: bajas y anulaciones',
    description: 'Ofrecer una alternativa a quien se dio de baja.',
  },
  {
    key: 'campaign_cross_sell',
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
  internal_chat: 'El plan de tus números no incluye el chat interno. Se puede cambiar en Facturación.',
  campaign_coverage_upgrade: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_quote_followup: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_renewal: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_winback: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
  campaign_cross_sell: 'El plan de tus números no incluye esta campaña. Se puede cambiar en Facturación.',
}

const KEYS = new Set<string>(PLAN_FEATURES.map(f => f.key))

/** A plan's stored functions as the full catalog: any function it does not turn off is included. */
export function featuresOf(stored: unknown): PlanFeatures {
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  return Object.fromEntries(PLAN_FEATURES.map(f => [f.key, map[f.key] !== false])) as PlanFeatures
}

/** Every function on: the owner, or an organization without a plan to read. */
export function allFeatures(): PlanFeatures {
  return featuresOf(null)
}

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
  if (!plans.length) return allFeatures()
  return Object.fromEntries(PLAN_FEATURES.map(f => [f.key, plans.some(p => p[f.key])])) as PlanFeatures
}
