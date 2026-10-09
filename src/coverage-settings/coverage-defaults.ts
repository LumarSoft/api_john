/**
 * Default wording for Triunfo coverage codes.
 *
 * Triunfo groups its auto coverages by letter prefix — A is mandatory liability
 * and each next letter adds protection — but the exact set of codes it returns
 * varies by vehicle and year (A, B, B1, B3, B4, C1, D2...), so codes are
 * discovered as they appear in quotes.
 *
 * Codes of the same letter are different products: B includes destrucción total
 * and B1 does not. Describing a code by its letter alone promised coverage the
 * client did not have, so each code is described from Triunfo's product manual
 * ("Automotores — Manual de producto y tarifa", septiembre 2026). A code the
 * manual does not describe starts as an empty template for the admin to fill.
 */
export interface CoverageCopy {
  name: string
  tagline: string
  benefits: string[]
  /** What the coverage does not include, so the client sees the difference. */
  exclusions: string[]
  /** Base ordering so newly discovered codes land in a sane position. */
  sortOrder: number
  /**
   * Offered while nobody has configured the code. Triunfo quotes up to 14 car
   * coverages for a new car; listing them all buries the client, so only the
   * ones the office sells day to day are on by default. The admin switches the
   * rest on from the panel, already described.
   */
  offered: boolean
}

const FAMILY: Record<string, { name: string; sortOrder: number }> = {
  A: { name: 'Responsabilidad Civil', sortOrder: 100 },
  B: { name: 'Todo Total', sortOrder: 200 },
  C: { name: 'Terceros Completo', sortOrder: 300 },
  D: { name: 'Todo Riesgo', sortOrder: 400 },
}

const UNKNOWN_PREFIX_SORT_ORDER = 900

// Shared lines, worded once so the same benefit reads the same everywhere.
const RC = 'Todo lo de Responsabilidad Civil'
// Spelled out rather than "todo lo de C": a single long line hid "robo parcial"
// and the bot answered that no coverage paid for a stolen stereo.
const C_BASE = [RC, 'Robo o hurto total y parcial', 'Incendio total y parcial', 'Destrucción total por accidente']
const ADD_ON_GLASS = 'Rotura de cristales (se puede sumar como adicional)'
const AUTO_RAISE = 'Los topes de los adicionales se actualizan solos en cada refacturación'

/**
 * Car coverages as Triunfo's product manual defines them. A car quote offers
 * the codes described here (when `offered`, or once an admin switches them on)
 * plus any code an admin described; a code nobody described is hidden, because
 * a guessed description is a promise the policy may not keep.
 *
 * C7 is not in the manual. It is most likely "C2 Full" (the only manual code
 * missing from Triunfo's quotes, and grouped with the D codes for wheels, as the
 * manual groups C2 Full), but stays undescribed until the office confirms it.
 */
const CAR_COPY: Record<string, CoverageCopy> = {
  A: {
    name: 'Responsabilidad Civil',
    tagline: 'La cobertura obligatoria para circular',
    benefits: [
      'Daños a terceros, personas y cosas (hasta $208.000.000 por evento)',
      'Cobertura obligatoria para circular (Ley 24.449)',
      'Asistencia jurídica',
      'Extensión a Chile, Bolivia y países del Mercosur',
    ],
    exclusions: ['Robo, incendio o daños de tu propio auto'],
    sortOrder: 100,
    offered: true,
  },
  B0: {
    name: 'Robo Total',
    tagline: 'RC + robo o hurto total',
    benefits: [RC, 'Robo o hurto total'],
    exclusions: ['Incendio', 'Destrucción total por accidente', 'Robo parcial', 'Daños parciales por accidente'],
    sortOrder: 199,
    offered: false,
  },
  B: {
    name: 'Todo Total',
    tagline: 'RC + robo, incendio y destrucción total',
    benefits: [RC, 'Robo o hurto total', 'Incendio total', 'Destrucción total por accidente'],
    exclusions: ['Robo e incendio parcial', 'Daños parciales por accidente', 'Granizo', ADD_ON_GLASS],
    sortOrder: 200,
    offered: true,
  },
  B1: {
    name: 'Robo e Incendio Total',
    tagline: 'RC + robo e incendio total, sin destrucción total',
    benefits: [RC, 'Robo o hurto total', 'Incendio total'],
    exclusions: [
      'Destrucción total por accidente',
      'Robo e incendio parcial',
      'Daños parciales por accidente',
      'Granizo',
      ADD_ON_GLASS,
    ],
    sortOrder: 201,
    offered: true,
  },
  B3: {
    name: 'Robo Total e Incendio Total y Parcial',
    tagline: 'RC + robo total + incendio total y parcial',
    benefits: [RC, 'Robo o hurto total', 'Incendio total y parcial'],
    exclusions: [
      'Destrucción total por accidente',
      'Robo parcial',
      'Daños parciales por accidente',
      'Granizo',
      ADD_ON_GLASS,
    ],
    sortOrder: 203,
    offered: false,
  },
  B4: {
    name: 'Incendio Total',
    tagline: 'RC + incendio total',
    benefits: [RC, 'Incendio total'],
    exclusions: [
      'Robo o hurto',
      'Destrucción total por accidente',
      'Daños parciales por accidente',
      'Granizo',
      ADD_ON_GLASS,
    ],
    sortOrder: 204,
    offered: false,
  },
  C1: {
    name: 'Terceros Completo sin Destrucción Total',
    tagline: 'RC + robo e incendio, totales y parciales',
    benefits: [RC, 'Robo o hurto total y parcial', 'Incendio total y parcial', 'Reposición de 1 rueda robada'],
    exclusions: ['Destrucción total por accidente', 'Daños parciales por accidente', 'Granizo', ADD_ON_GLASS],
    sortOrder: 301,
    offered: false,
  },
  C: {
    name: 'Terceros Completo',
    tagline: 'RC + robo e incendio totales y parciales + destrucción total',
    benefits: [
      RC,
      'Robo o hurto total y parcial',
      'Incendio total y parcial',
      'Destrucción total por accidente',
      'Reposición de 1 rueda robada',
    ],
    exclusions: ['Daños parciales por accidente', 'Granizo', ADD_ON_GLASS],
    sortOrder: 300,
    offered: false,
  },
  C2: {
    name: 'Terceros Completo con Adicionales',
    tagline: 'Terceros Completo + cristales, cerraduras, granizo e inundación con tope',
    benefits: [
      ...C_BASE,
      'Parabrisas y luneta hasta $500.000',
      'Cristal de techo hasta $500.000',
      'Otros cristales por cualquier causa y cerraduras por robo hasta $500.000',
      'Granizo hasta $500.000',
      'Inundación hasta $400.000',
      'Daños al auto robado y recuperado hasta $400.000',
      'Reposición de ruedas robadas: 1 por evento, 2 eventos por año',
      AUTO_RAISE,
    ],
    exclusions: ['Daños parciales por accidente'],
    sortOrder: 302,
    offered: true,
  },
  C8: {
    name: 'Terceros Completo con Cristales',
    tagline: 'Terceros Completo + cristales y cerraduras hasta el valor del auto',
    benefits: [
      ...C_BASE,
      'Cristales por cualquier causa y cerraduras por robo (sin llaves) hasta la suma asegurada del auto',
      'Parabrisas o luneta: 1 reposición por año',
      'Granizo hasta $500.000',
      'Daños al auto robado y recuperado hasta $400.000',
      'Reposición de ruedas robadas: 1 por evento, 2 eventos por año',
      AUTO_RAISE,
    ],
    exclusions: ['Daños parciales por accidente', 'Inundación'],
    sortOrder: 308,
    offered: false,
  },
  D: {
    name: 'Todo Riesgo sin Franquicia',
    tagline: 'Cubre también los daños por accidente, sin franquicia',
    benefits: [
      ...C_BASE,
      'Daños por accidente, totales y parciales, sin franquicia',
      'Cristales, cerraduras, granizo e inundación sin franquicia',
      'Reposición de ruedas robadas: 2 por evento, 2 eventos por año',
    ],
    exclusions: [],
    sortOrder: 400,
    offered: false,
  },
  D2: {
    name: 'Todo Riesgo con Franquicia Fija',
    tagline: 'Cubre también los daños por accidente, con franquicia fija',
    benefits: [
      ...C_BASE,
      'Daños por accidente, totales y parciales',
      'Cristales, cerraduras, granizo e inundación sin franquicia',
      'Reposición de ruedas robadas: 2 por evento, 2 eventos por año',
    ],
    exclusions: [
      'Una franquicia fija por cada daño por accidente: según la opción, desde $400.000 (autos nacionales o del Mercosur) o $600.000 (importados)',
    ],
    sortOrder: 402,
    offered: false,
  },
  D3: {
    name: 'Todo Riesgo con Franquicia del 10%',
    tagline: 'Cubre también los daños por accidente, con franquicia variable',
    benefits: [
      ...C_BASE,
      'Daños por accidente, totales y parciales',
      'Cristales, cerraduras y granizo sin franquicia',
      'Reposición de ruedas robadas: 2 por evento, 2 eventos por año',
    ],
    exclusions: ['La franquicia de cada daño por accidente: 10% del siniestro, mínimo $550.000'],
    sortOrder: 403,
    offered: true,
  },
  D4: {
    name: 'Todo Riesgo con Franquicia del 5%',
    tagline: 'Cubre también los daños por accidente, con franquicia del 5% de la suma asegurada',
    benefits: [
      ...C_BASE,
      'Daños por accidente, totales y parciales',
      'Cristales, cerraduras, granizo e inundación sin franquicia',
      'Reposición de ruedas robadas: 2 por evento, 2 eventos por año',
    ],
    exclusions: ['La franquicia de cada daño por accidente: 5% de la suma asegurada'],
    sortOrder: 404,
    offered: false,
  },
}

/**
 * Wording a car coverage code starts with: the manual's description when there
 * is one, otherwise an empty template named after its family ("Todo Total 5")
 * that the admin completes — and that is not offered until they do. Codes of a
 * family sort among themselves by their numeric suffix: B, B1, B3 → 200, 201, 203.
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
      offered: false,
    }
  }

  const suffix = Number.parseInt(trimmed.slice(1), 10)
  return {
    name: trimmed.length > 1 ? `${family.name} ${trimmed.slice(1)}` : family.name,
    tagline: '',
    benefits: [],
    exclusions: [],
    sortOrder: family.sortOrder + (Number.isFinite(suffix) ? suffix : 0),
    offered: false,
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
    offered: true,
  },
  B4: {
    name: 'Responsabilidad civil + incendio',
    tagline: 'RC más incendio total',
    benefits: ['Todo lo de Responsabilidad civil', 'Incendio total', 'Ajuste automático de suma asegurada (10%)'],
    exclusions: ['Robo y/o hurto', 'Daños a la moto por accidente'],
    sortOrder: 200,
    offered: true,
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
    offered: true,
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
    offered: false,
  },
}

/** Wording for a motorcycle coverage code; unknown codes fall back to the car copy. */
export function motoCopyFor(code: string): CoverageCopy {
  return MOTO_COPY[code.trim().toUpperCase()] ?? defaultCopyFor(code)
}
