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
