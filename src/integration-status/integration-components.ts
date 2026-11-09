/**
 * Every external service the Status section reports, in the order it lists
 * them. A Triunfo key is "triunfo." plus the web service's own name, the same
 * operation TriunfoError records.
 *
 * Each document's download is its own service, by its RESTDocumentosV2 code
 * (most requested first): every one comes from its own TriunfoNet page, and
 * from 3/11/2026 only the constancia de pago's answered 404. As one service,
 * its incident ended with whatever other PDF was asked next and the alert
 * said every PDF was failing. A code without its own key (1010, a second
 * certificate that personal accident policies list) is "triunfo.documentDownload".
 */
export const INTEGRATION_COMPONENTS = [
  'triunfo.getTokenRest',
  'triunfo.RESTCotizadorAutV2',
  'triunfo.RESTDocumentosV2',
  'triunfo.documentDownload.1050',
  'triunfo.documentDownload.1000',
  'triunfo.documentDownload.1040',
  'triunfo.documentDownload.1060',
  'triunfo.documentDownload.1020',
  'triunfo.documentDownload.1030',
  'triunfo.documentDownload',
  'triunfo.RESTNovedadesCartera',
  'infoauto.cars',
  'infoauto.motorcycles',
] as const

export type IntegrationComponentKey = (typeof INTEGRATION_COMPONENTS)[number]

/** The Status service of a document's download: its own, or the shared one for a code without it. */
export function documentDownloadKey(code: string): IntegrationComponentKey {
  const key = `triunfo.documentDownload.${code}`
  return (INTEGRATION_COMPONENTS as readonly string[]).includes(key)
    ? (key as IntegrationComponentKey)
    : 'triunfo.documentDownload'
}

export interface ComponentContext {
  provider: string
  service: string
  /** What the platform uses it for, so the AI model can say what stops working. */
  purpose: string
}

/** Each service as the AI model reads it when it explains an incident. */
export const COMPONENT_CONTEXT: Record<IntegrationComponentKey, ComponentContext> = {
  'triunfo.getTokenRest': {
    provider: 'Triunfo Seguros',
    service: 'getTokenRest, el login de sus web services',
    purpose: 'abre la sesión con la que se cotiza y se pide la documentación de las pólizas',
  },
  'triunfo.RESTCotizadorAutV2': {
    provider: 'Triunfo Seguros',
    service: 'RESTCotizadorAutV2, el cotizador de autos y motos',
    purpose: 'cotiza autos y motos para el bot de WhatsApp y el panel',
  },
  'triunfo.RESTDocumentosV2': {
    provider: 'Triunfo Seguros',
    service: 'RESTDocumentosV2, la documentación de pólizas',
    purpose:
      'lista los documentos de una póliza (certificado, póliza, tarjeta Mercosur, constancia de pago y cuponera) que manda el bot y se bajan desde el panel',
  },
  'triunfo.documentDownload.1050': documentDownload('de la tarjeta verde (Mercosur)'),
  'triunfo.documentDownload.1000': documentDownload('del certificado de cobertura'),
  'triunfo.documentDownload.1040': documentDownload('de la constancia de pago'),
  'triunfo.documentDownload.1060': documentDownload('de la cuponera de pago'),
  'triunfo.documentDownload.1020': documentDownload('de la póliza'),
  'triunfo.documentDownload.1030': documentDownload('de las cláusulas'),
  'triunfo.documentDownload': documentDownload('de otros documentos'),
  'triunfo.RESTNovedadesCartera': {
    provider: 'Triunfo Seguros',
    service: 'RESTNovedadesCartera, las novedades de la cartera',
    purpose: 'actualiza pólizas, cuotas y pagos dos veces por día',
  },
  'infoauto.cars': {
    provider: 'InfoAuto',
    service: 'el catálogo de autos',
    purpose: 'da marcas, modelos y versiones para cotizar autos',
  },
  'infoauto.motorcycles': {
    provider: 'InfoAuto',
    service: 'el catálogo de motos',
    purpose: 'da marcas, modelos y versiones para cotizar motos',
  },
}

/** One document's download, as the AI model reads it: "de la constancia de pago". */
function documentDownload(document: string): ComponentContext {
  return {
    provider: 'Triunfo Seguros',
    service: `la descarga del PDF ${document} desde TriunfoNet`,
    purpose: `baja el PDF ${document} de una póliza, que manda el bot y se baja desde el panel; cada documento sale de su propia página de TriunfoNet, así que los demás pueden andar`,
  }
}
