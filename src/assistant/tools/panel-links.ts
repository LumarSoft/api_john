import { ActionLink } from './tool.types'

/**
 * Where a confirmed change is seen in the panel: the exact tab and section,
 * as the panels read them (src/features/admin/hooks/use-panel-link.ts): `tab`
 * picks the tab, `seccion` lights up the element with that data-help, and
 * `numero` / `siniestro` open that record.
 */
export function configLink(tab: string, seccion?: string): ActionLink {
  return {
    route: `/admin/configuracion?tab=${tab}${seccion ? `&seccion=${seccion}` : ''}`,
    label: 'Ver en Configuración',
  }
}

export function numberLink(numberId: number, seccion: string): ActionLink {
  return { route: `/admin/numeros?numero=${numberId}&seccion=${seccion}`, label: 'Ver en el número' }
}

/** The section of Configuración › Asistente › Datos de la productora each field is in. */
export const PROFILE_SECTION: Record<string, string> = {
  orgName: 'config-presentacion',
  orgShortName: 'config-presentacion',
  orgLegalName: 'config-presentacion',
  towTruckPhone: 'config-asistencia',
  claimsPhone: 'config-asistencia',
  claimsEmail: 'config-asistencia',
  cashPaymentPlaces: 'config-pagos',
  transferAlias: 'config-pagos',
  transferCbu: 'config-pagos',
  transferHolder: 'config-pagos',
  transferBank: 'config-pagos',
  quoteClosingNote: 'config-cotizaciones',
}
