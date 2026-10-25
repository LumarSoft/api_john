/**
 * What the bot shows of a policy beyond its number: a short name for a policy
 * that is not a vehicle ("Bicicleta", "Sepelio" instead of "Otro riesgo" or
 * "Vida" three times in a list), the place it insures, and the coverages
 * Triunfo lists on it, so "¿tengo cubiertos los cristales?" is answered from
 * the policy itself.
 *
 * Everything comes from the cartera row Triunfo sent (rawData): for a
 * non-vehicle policy, SDTOtrosRiesgosDatos carries each covered risk with its
 * sum insured and ObjetoSeguroDescripcion the insured address.
 */

export interface RiesgoCubierto {
  /** Triunfo's risk group: "INCENDIO", "ROBO", "CRISTALES", "RESPONSABILIDAD CIVIL"… */
  riesgo: string
  /** The coverage within it: "EDIFICIO", "CONTENIDO GENERAL", "DAÑOS ELECTROD/ELECT"… */
  cobertura: string
  /** Sum insured in pesos; null when Triunfo sent none. */
  sumaAsegurada: number | null
}

/** The cartera row as stored (rawData) or as Triunfo just sent it. */
type Raw = object | null | undefined

function otrosRiesgos(raw: Raw): Record<string, unknown> | null {
  const value = (raw as Record<string, unknown> | null | undefined)?.SDTOtrosRiesgosDatos
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Triunfo writes Ñ as "#" in these names ("DA#OS TOTALES"). */
const clean = (text: unknown): string =>
  String(text ?? '')
    .replace(/#/g, 'Ñ')
    .replace(/\s+/g, ' ')
    .trim()

/** The coverages Triunfo lists on a non-vehicle policy, in its order. */
export function riesgosOf(raw: Raw): RiesgoCubierto[] {
  const list = otrosRiesgos(raw)?.SDTRiesgosCoberturas
  if (!Array.isArray(list)) return []
  return list
    .map(item => {
      const row = (item ?? {}) as Record<string, unknown>
      const suma = Number.parseFloat(String(row.SumaAsegurada ?? ''))
      return {
        riesgo: clean(row.Riesgo),
        cobertura: clean(row.Cobertura),
        sumaAsegurada: Number.isFinite(suma) && suma > 0 ? suma : null,
      }
    })
    .filter(r => r.riesgo || r.cobertura)
}

const has = (riesgos: RiesgoCubierto[], re: RegExp) => riesgos.some(r => re.test(`${r.riesgo} ${r.cobertura}`))

/** Sepelio or personal accident coverages: the policy insures a person, not a thing. */
export const insuresAPerson = (riesgos: RiesgoCubierto[]): boolean => has(riesgos, /SEPELIO|MUERTE|INCAP/)

/**
 * Triunfo's articles for policies on a person, for the rows that list no
 * coverages: 197 is sepelio, the rest personal accidents. None is a life
 * policy, although they share the 'life' risk type.
 */
const PERSON_ARTICLES: Record<number, string> = {
  197: 'Sepelio',
  128: 'Acc. personales',
  124: 'Acc. personales',
  195: 'Acc. personales',
}

/**
 * A short name for a policy that is not a vehicle, read from what it covers
 * (or, for a policy on a person that lists nothing, from its article). Kept
 * short: it is the title of a WhatsApp list row (24 characters at most).
 * Null for vehicles, which go by brand and model.
 */
export function productOf(riskType: string, riesgos: RiesgoCubierto[], articulo?: unknown): string | null {
  switch (riskType) {
    case 'auto':
    case 'moto':
      return null
    case 'home':
      return 'Hogar'
    case 'commercial':
      return 'Comercio'
  }
  if (has(riesgos, /SEPELIO/)) return 'Sepelio'
  if (has(riesgos, /BICICLETA/)) return 'Bicicleta'
  if (has(riesgos, /MONOPATIN/)) return 'Monopatín'
  if (has(riesgos, /BOLSO/)) return 'Bolso protegido'
  if (has(riesgos, /MUERTE|INCAP|A\.M\.F|ITINERE/)) return 'Acc. personales'
  if (has(riesgos, /EQUIPOS? CONTRATISTA/)) return 'Equipos'
  if (has(riesgos, /TERRESTRE|TRANSPORT|VEHICULOS TRAN/)) return 'Transporte'
  if (riskType === 'life') return PERSON_ARTICLES[Number(articulo)] ?? 'Vida'
  if (riesgos.length && riesgos.every(r => /RESPONSABILIDAD CIVIL/.test(r.riesgo))) return 'Resp. civil'
  if (riesgos.length && riesgos.every(r => /INCENDIO/.test(r.riesgo))) return 'Incendio'
  return null
}

/**
 * The insured address of a home, shop or other place ("San Martín 4060"), so a
 * client with two homes tells them apart. Not for life or personal accident
 * policies, where Triunfo puts the insured person's name and DNI there.
 */
export function placeOf(riskType: string, raw: Raw, riesgos: RiesgoCubierto[]): string | null {
  if (riskType === 'auto' || riskType === 'moto' || riskType === 'life') return null
  if (has(riesgos, /SEPELIO|MUERTE|INCAP|CATEGORIA/)) return null
  const text = clean(otrosRiesgos(raw)?.ObjetoSeguroDescripcion)
    .replace(/\s*C\.P\.?\s*:?\s*\d+\s*$/i, '')
    .replace(/[.\s]+$/, '')
  if (!text || /CUALQUIER LUGAR|TERRITORIO NACIONAL|REP\.? ARG/i.test(text) || /DNI/i.test(text)) return null
  const titled = text
    .toLowerCase()
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
  return titled.length > 40 ? `${titled.slice(0, 39)}…` : titled
}
