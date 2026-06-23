/**
 * Canonical product catalog (single source of truth for the marketing copy that
 * both the WhatsApp bot and the public web consume). Prices live elsewhere —
 * instant quotes come from Triunfo (auto/moto) and fixed plans from ProductPlan
 * (bolso/hogar) — so this catalog is intentionally price-free: it only describes
 * what each coverage includes/excludes so the bot can answer "¿qué cubre X?"
 * with the same wording the site uses.
 *
 * `flow` mirrors the quote path each product follows, so callers know whether a
 * product is quoted instantly, has fixed plans, or only captures an advisor lead.
 */
export type ProductFlow = 'instant' | 'fixed' | 'lead'

export interface ProductCatalogItem {
  id: string
  label: string
  /** One-line subtitle, e.g. "Todo riesgo, terceros completo". */
  sub: string
  /** Longer description of the coverage. */
  summary: string
  /** What the coverage includes. */
  includes: string[]
  /** What the coverage does not include. */
  excludes: string[]
  flow: ProductFlow
}

export const PRODUCT_CATALOG: ProductCatalogItem[] = [
  {
    id: 'auto',
    label: 'Auto',
    sub: 'Todo riesgo, terceros completo',
    summary:
      'Cobertura para vehículos particulares y comerciales en todo el territorio nacional. Atención de siniestros sin franquicia variable y peritaje propio.',
    includes: ['Responsabilidad civil', 'Robo, hurto y daño total', 'Granizo y daños parciales', 'Auto de reemplazo'],
    excludes: ['Conducción sin registro', 'Daños preexistentes', 'Uso fuera de territorio'],
    flow: 'instant',
  },
  {
    id: 'moto',
    label: 'Moto',
    sub: 'Cualquier cilindrada',
    summary: 'Pólizas para motos de uso particular y de reparto, con cobertura ampliada para accesorios y casco.',
    includes: ['Responsabilidad civil', 'Robo total y de partes', 'Casco y accesorios', 'Asistencia mecánica'],
    excludes: ['Uso deportivo', 'Modificaciones no declaradas'],
    flow: 'instant',
  },
  {
    id: 'bici',
    label: 'Bicicletas',
    sub: 'Urbanas, MTB y eléctricas',
    summary:
      'Especial para ciclistas urbanos y deportivos. Incluye cobertura por robo en la vía pública y daños propios.',
    includes: ['Robo y hurto', 'Daños accidentales', 'Responsabilidad civil', 'Traslado a domicilio'],
    excludes: ['Competencias profesionales'],
    flow: 'lead',
  },
  {
    id: 'bolso',
    label: 'Bolso protegido',
    sub: 'Robo, hurto y contenido',
    summary:
      'Protección integral para tu cartera, billetera, notebook y dispositivos electrónicos en la calle o en el trabajo.',
    includes: ['Robo en vía pública', 'Hurto en transporte', 'Reposición de documentación', 'Asistencia inmediata'],
    excludes: ['Bienes no declarados'],
    flow: 'fixed',
  },
  {
    id: 'comercio',
    label: 'Comercio e Industria',
    sub: 'Locales, depósitos y plantas',
    summary:
      'Cobertura integral para comercios, oficinas, depósitos y plantas industriales: incendio, robo, cristales, responsabilidad civil y lucro cesante.',
    includes: ['Incendio y rayo', 'Robo de mercadería', 'Cristales y carteles', 'Lucro cesante'],
    excludes: ['Materiales prohibidos', 'Falta de medidas mínimas de seguridad'],
    flow: 'lead',
  },
  {
    id: 'hogar',
    label: 'Hogar',
    sub: 'Edificio y contenido',
    summary:
      'Para casas, departamentos y countries: incendio, robo de contenido, daños por agua, cristales y responsabilidad civil hacia terceros.',
    includes: ['Incendio y explosión', 'Robo de contenido', 'Daños por agua', 'RC frente a vecinos'],
    excludes: ['Reformas estructurales en curso'],
    flow: 'fixed',
  },
  {
    id: 'personas',
    label: 'Personas',
    sub: 'Vida, accidentes y salud',
    summary:
      'Coberturas de vida individual, accidentes personales, sepelio y salud, con suma asegurada ajustable por inflación.',
    includes: ['Vida con ajuste anual', 'Accidentes personales', 'Sepelio', 'Asistencia médica'],
    excludes: ['Patologías preexistentes no declaradas'],
    flow: 'lead',
  },
  {
    id: 'praxis',
    label: 'Praxis profesional',
    sub: 'Responsabilidad civil profesional',
    summary:
      'Mala praxis médica, arquitectura, contaduría y profesiones técnicas. Defensa jurídica e indemnización a terceros.',
    includes: ['Defensa jurídica', 'Indemnización a terceros', 'Reclamos posteriores', 'Asistencia letrada 24/7'],
    excludes: ['Actuación fuera de matrícula'],
    flow: 'lead',
  },
]
