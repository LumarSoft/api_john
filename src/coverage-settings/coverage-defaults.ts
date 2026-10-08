/**
 * Fallback wording for a coverage code nobody has configured yet.
 *
 * Triunfo groups its auto coverages by letter prefix — A is mandatory liability
 * and each next letter adds protection — but the exact set of codes it returns
 * varies by vehicle and year (A, B, B1, B3, B4, C1, D2...). There is no published
 * list, so codes are discovered as they appear in quotes.
 *
 * A discovered code inherits the copy of its prefix, which gives it a sensible
 * name from minute one. The admin then renames it to whatever the broker wants.
 */
export interface CoverageCopy {
  name: string
  tagline: string
  benefits: string[]
  /** Base ordering so newly discovered codes land in a sane position. */
  sortOrder: number
}

const PREFIX_COPY: Record<string, CoverageCopy> = {
  A: {
    name: 'Responsabilidad Civil',
    tagline: 'La cobertura obligatoria para circular',
    benefits: [
      'Daños a terceros, personas y cosas',
      'Cobertura obligatoria (Ley 24.449)',
      'Asistencia y defensa legal',
      'Validez en países limítrofes',
    ],
    sortOrder: 100,
  },
  B: {
    name: 'Todo Total',
    tagline: 'Responsabilidad civil + pérdidas totales',
    benefits: [
      'Todo lo de Responsabilidad Civil',
      'Robo y hurto total',
      'Incendio total',
      'Destrucción total por accidente',
    ],
    sortOrder: 200,
  },
  C: {
    name: 'Terceros Completo',
    tagline: 'La más elegida',
    benefits: [
      'Todo lo de Todo Total',
      'Robo, hurto e incendio parcial',
      'Rotura de cristales y cerraduras',
      'Granizo, inundación y terremoto',
    ],
    sortOrder: 300,
  },
  D: {
    name: 'Todo Riesgo',
    tagline: 'Protección máxima para tu vehículo',
    benefits: [
      'Todo lo de Terceros Completo',
      'Daños parciales por accidente',
      'Franquicia según plan',
      'Cobertura integral del vehículo',
    ],
    sortOrder: 400,
  },
}

const UNKNOWN_PREFIX_SORT_ORDER = 900

/** Commercial copy a freshly discovered code starts with. */
export function defaultCopyFor(code: string): CoverageCopy {
  const prefix = code.trim().charAt(0).toUpperCase()
  const base = PREFIX_COPY[prefix]

  if (!base) {
    return {
      name: `Cobertura ${code}`,
      tagline: '',
      benefits: [],
      sortOrder: UNKNOWN_PREFIX_SORT_ORDER,
    }
  }

  // Codes of the same family keep the family's order and sort among themselves by
  // their numeric suffix: B, B1, B3, B4 → 200, 201, 203, 204.
  const suffix = Number.parseInt(code.trim().slice(1), 10)
  return {
    ...base,
    name: code.trim().length > 1 ? `${base.name} ${code.trim().slice(1)}` : base.name,
    sortOrder: base.sortOrder + (Number.isFinite(suffix) ? suffix : 0),
  }
}

/**
 * Motorcycle coverages, named as Triunfo's own cotizador names them. Triunfo
 * quotes motos with the same letter codes as cars, but the products behind them
 * differ (B1 on a moto is "RC + incendio + robo", on a car "Todo Total 1"), so
 * the car wording and the producer's car settings must never leak into a moto
 * quote. The benefit lists mirror the comparison table on Triunfo's web.
 */
const MOTO_COPY: Record<string, CoverageCopy> = {
  A: {
    name: 'Responsabilidad civil',
    tagline: 'La cobertura obligatoria para circular',
    benefits: [
      'Responsabilidad civil hacia terceros',
      'Extensión de cobertura a países limítrofes',
      'Asistencia jurídica',
      'Seguro de vida y sepelio',
    ],
    sortOrder: 100,
  },
  B4: {
    name: 'Responsabilidad civil + incendio',
    tagline: 'RC más incendio total',
    benefits: ['Todo lo de Responsabilidad civil', 'Incendio total', 'Ajuste automático de suma asegurada (10%)'],
    sortOrder: 200,
  },
  B1: {
    name: 'RC + incendio + robo',
    tagline: 'RC más incendio y robo total',
    benefits: [
      'Todo lo de Responsabilidad civil + incendio',
      'Robo y/o hurto total',
      'Ajuste automático de suma asegurada (10%)',
    ],
    sortOrder: 300,
  },
  B: {
    name: 'Todo total',
    tagline: 'RC más robo, incendio y destrucción total',
    benefits: [
      'Todo lo de Responsabilidad civil',
      'Robo y/o hurto total',
      'Incendio total',
      'Destrucción total por accidente',
    ],
    sortOrder: 400,
  },
}

/** Wording for a motorcycle coverage code; unknown codes fall back to the car copy. */
export function motoCopyFor(code: string): CoverageCopy {
  return MOTO_COPY[code.trim().toUpperCase()] ?? defaultCopyFor(code)
}
