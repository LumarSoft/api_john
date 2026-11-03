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
