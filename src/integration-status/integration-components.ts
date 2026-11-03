/**
 * Every external service the Status section reports, in the order it lists
 * them. A Triunfo key is "triunfo." plus the web service's own name, the same
 * operation TriunfoError records.
 */
export const INTEGRATION_COMPONENTS = [
  'triunfo.getTokenRest',
  'triunfo.RESTCotizadorAutV2',
  'triunfo.RESTDocumentosV2',
  'triunfo.documentDownload',
  'triunfo.RESTNovedadesCartera',
  'infoauto.cars',
  'infoauto.motorcycles',
] as const

export type IntegrationComponentKey = (typeof INTEGRATION_COMPONENTS)[number]

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
  'triunfo.documentDownload': {
    provider: 'Triunfo Seguros',
    service: 'la descarga de PDFs de TriunfoNet',
    purpose: 'baja cada documento de una póliza',
  },
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
