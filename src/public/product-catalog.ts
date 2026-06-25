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

/**
 * A single data point the advisor-contact (lead) flow captures for a product.
 * This is the single source of truth for *what gets asked*: the public web
 * renders these as form inputs and the WhatsApp bot asks them one by one, so the
 * questions — and therefore the lead detail the admin sees — stay identical.
 * Only `lead` products carry fields (instant quotes and fixed plans don't).
 */
export interface CatalogField {
  /** Doubles as the payload key, so it must match across web and bot. */
  label: string
  placeholder: string
  /** Web layout hint; ignored by the bot. */
  span?: 'half' | 'full'
  /** Web input kind; `select` renders a dropdown (web) / list picker (bot). */
  type?: 'text' | 'select'
  options?: string[]
  /** Short clarification shown under the field on the web. */
  help?: string
  /**
   * Natural-language question the WhatsApp bot asks for this field (the web only
   * shows `label`). Self-contained — write the full friendly phrasing here; when
   * omitted the bot falls back to a generic "Decime *label*…" prompt.
   */
  question?: string
  /** When true the bot validates the answer as a positive number. */
  numeric?: boolean
}

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
  /** Lead-flow data points captured by the web form and the bot. Empty for
   * instant/fixed products, which don't run the contact-form capture. */
  fields: CatalogField[]
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
    fields: [],
  },
  {
    id: 'moto',
    label: 'Moto',
    sub: 'Cualquier cilindrada',
    summary: 'Pólizas para motos de uso particular y de reparto, con cobertura ampliada para accesorios y casco.',
    includes: ['Responsabilidad civil', 'Robo total y de partes', 'Casco y accesorios', 'Asistencia mecánica'],
    excludes: ['Uso deportivo', 'Modificaciones no declaradas'],
    flow: 'instant',
    fields: [],
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
    fields: [
      {
        label: 'Marca y modelo',
        placeholder: 'Trek FX3, Specialized Sirrus…',
        span: 'full',
        question: '¿Qué *marca y modelo* es el rodado? (por ejemplo: Trek FX3, Specialized Sirrus)',
      },
      {
        label: 'Tipo',
        placeholder: 'Seleccioná',
        type: 'select',
        options: ['Urbana', 'MTB', 'Ruta', 'Eléctrica', 'Monopatín'],
        span: 'half',
        question: '¿Qué tipo de rodado es?',
      },
      {
        label: 'Valor del rodado ($)',
        placeholder: '350.000',
        span: 'half',
        numeric: true,
        question: '¿Cuál es el *valor aproximado* del rodado, en pesos? (por ejemplo: 350.000)',
      },
    ],
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
    fields: [],
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
    fields: [
      {
        label: 'Actividad comercial',
        placeholder: 'Ferretería, restaurante, estudio…',
        span: 'full',
        question:
          '¿A qué se dedica el comercio? Contame el rubro o la actividad (por ejemplo: ferretería, restaurante, estudio).',
      },
      {
        label: 'Dirección del local',
        placeholder: 'Blvd. 27 de Febrero 275',
        span: 'full',
        question: '¿Cuál es la *dirección del local*? (calle, número y localidad)',
      },
      {
        label: 'Superficie (m²)',
        placeholder: '120',
        span: 'half',
        numeric: true,
        question: '¿Qué *superficie* tiene el local, en metros cuadrados? (por ejemplo: 120)',
      },
      {
        label: 'Valor de mercadería ($)',
        placeholder: '1.000.000',
        span: 'half',
        numeric: true,
        help: 'Valor aprox. del stock y bienes del local',
        question:
          '¿Por qué *valor aproximado* querés asegurar la mercadería y los bienes del local, en pesos? (por ejemplo: 1.000.000)',
      },
    ],
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
    fields: [],
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
    fields: [
      {
        label: 'Fecha de nacimiento',
        placeholder: 'DD/MM/AAAA',
        span: 'half',
        question: '¿Cuál es tu *fecha de nacimiento*? Escribila como DD/MM/AAAA (por ejemplo: 15/04/1985).',
      },
      {
        label: 'Actividad',
        placeholder: 'Empleado, autónomo, jubilado…',
        span: 'half',
        question: '¿A qué te dedicás? (por ejemplo: empleado, autónomo, jubilado)',
      },
    ],
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
    fields: [
      {
        label: 'Profesión',
        placeholder: 'Médico, arquitecto, contador…',
        span: 'half',
        question: '¿Cuál es tu *profesión*? (por ejemplo: médico, arquitecto, contador)',
      },
      {
        label: 'Especialidad / Matrícula',
        placeholder: 'Cardiología / MP 12345',
        span: 'half',
        question: '¿Cuál es tu *especialidad* y tu *número de matrícula*? (por ejemplo: Cardiología / MP 12345)',
      },
    ],
  },
]
