/**
 * Default wording for Triunfo coverage codes.
 *
 * Triunfo groups its auto coverages by letter prefix — A is mandatory liability
 * and each next letter adds protection — but the exact set of codes it returns
 * varies by vehicle and year (A, B, B1, B3, B4, C1, D2...). There is no published
 * list, so codes are discovered as they appear in quotes.
 *
 * Codes of the same letter are different products: B includes destrucción total
 * and B1 does not. Describing a code by its letter alone promised coverage the
 * client did not have, so only codes whose content the office confirmed carry a
 * description here; the rest start as an empty template for the admin to fill.
 */
export interface CoverageCopy {
  name: string
  tagline: string
  benefits: string[]
  /** What the coverage does not include, so the client sees the difference. */
  exclusions: string[]
  /** Base ordering so newly discovered codes land in a sane position. */
  sortOrder: number
}

const FAMILY: Record<string, { name: string; sortOrder: number }> = {
  A: { name: 'Responsabilidad Civil', sortOrder: 100 },
  B: { name: 'Todo Total', sortOrder: 200 },
  C: { name: 'Terceros Completo', sortOrder: 300 },
  D: { name: 'Todo Riesgo', sortOrder: 400 },
}

const UNKNOWN_PREFIX_SORT_ORDER = 900

/**
 * Car coverages whose content the office confirmed, worded the way the office
 * explains them to clients when quoting by hand. A car quote only offers these
 * codes plus the ones an admin configured: a code nobody described is hidden,
 * because a guessed description is a promise the policy may not keep.
 */
const CAR_COPY: Record<string, CoverageCopy> = {
  A: {
    name: 'Responsabilidad Civil',
    tagline: 'La cobertura obligatoria para circular',
    benefits: [
      'Daños a terceros, personas y cosas',
      'Cobertura obligatoria (Ley 24.449)',
      'Asistencia y defensa legal',
      'Validez en países limítrofes',
    ],
    exclusions: ['Robo, incendio o daños de tu propio auto'],
    sortOrder: 100,
  },
  B: {
    name: 'Todo Total',
    tagline: 'RC + robo, incendio y destrucción total',
    benefits: [
      'Todo lo de Responsabilidad Civil',
      'Robo y/o hurto total',
      'Incendio total',
      'Destrucción total por accidente',
    ],
    exclusions: ['Robo e incendio parcial', 'Daños parciales por accidente'],
    sortOrder: 200,
  },
  B1: {
    name: 'Robo e Incendio Total',
    tagline: 'RC + robo e incendio total, sin destrucción total',
    benefits: ['Todo lo de Responsabilidad Civil', 'Robo y/o hurto total', 'Incendio total'],
    exclusions: ['Destrucción total por accidente', 'Robo e incendio parcial', 'Daños parciales por accidente'],
    sortOrder: 201,
  },
  C2: {
    name: 'Terceros Completo',
    tagline: 'Todo Total + robo e incendio parcial, cristales y granizo',
    benefits: [
      'Todo lo de Todo Total (robo, incendio y destrucción total)',
      'Robo e incendio parcial',
      'Cristales, cerraduras y granizo hasta $1.000.000',
    ],
    exclusions: ['Daños parciales por accidente'],
    sortOrder: 302,
  },
  D3: {
    name: 'Todo Riesgo',
    tagline: 'Cubre también los daños parciales por accidente, con franquicia',
    benefits: ['Todo lo de Terceros Completo', 'Daños parciales por accidente'],
    exclusions: ['La franquicia de cada daño parcial: 10% del siniestro, mínimo $550.000'],
    sortOrder: 403,
  },
}

/** True when the office confirmed what this car coverage includes. */
export function hasConfirmedCarCopy(code: string): boolean {
  return code.trim().toUpperCase() in CAR_COPY
}

/**
 * Wording a car coverage code starts with: the confirmed copy when there is one,
 * otherwise an empty template named after its family ("Todo Total 4") that the
 * admin completes. Codes of a family sort among themselves by their numeric
 * suffix: B, B1, B3, B4 → 200, 201, 203, 204.
 */
export function defaultCopyFor(code: string): CoverageCopy {
  const trimmed = code.trim()
  const confirmed = CAR_COPY[trimmed.toUpperCase()]
  if (confirmed) return confirmed

  const family = FAMILY[trimmed.charAt(0).toUpperCase()]
  if (!family) {
    return {
      name: `Cobertura ${trimmed}`,
      tagline: '',
      benefits: [],
      exclusions: [],
      sortOrder: UNKNOWN_PREFIX_SORT_ORDER,
    }
  }

  const suffix = Number.parseInt(trimmed.slice(1), 10)
  return {
    name: trimmed.length > 1 ? `${family.name} ${trimmed.slice(1)}` : family.name,
    tagline: '',
    benefits: [],
    exclusions: [],
    sortOrder: family.sortOrder + (Number.isFinite(suffix) ? suffix : 0),
  }
}

/**
 * Motorcycle coverages, named as Triunfo's own cotizador names them. Triunfo
 * quotes motos with the same letter codes as cars, but the products behind them
 * differ (B1 on a moto is "RC + incendio + robo"), so the car wording and the
 * producer's car settings must never leak into a moto quote. The benefit lists
 * mirror the comparison table on Triunfo's web.
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
    exclusions: ['Robo, incendio o daños de tu propia moto'],
    sortOrder: 100,
  },
  B4: {
    name: 'Responsabilidad civil + incendio',
    tagline: 'RC más incendio total',
    benefits: ['Todo lo de Responsabilidad civil', 'Incendio total', 'Ajuste automático de suma asegurada (10%)'],
    exclusions: ['Robo y/o hurto', 'Daños a la moto por accidente'],
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
    exclusions: ['Daños a la moto por accidente'],
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
    exclusions: ['Daños parciales por accidente'],
    sortOrder: 400,
  },
}

/** Wording for a motorcycle coverage code; unknown codes fall back to the car copy. */
export function motoCopyFor(code: string): CoverageCopy {
  return MOTO_COPY[code.trim().toUpperCase()] ?? defaultCopyFor(code)
}
