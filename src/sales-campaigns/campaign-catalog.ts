import { BadRequestException } from '@nestjs/common'
import { SalesCampaignKind } from 'generated/prisma/client'
import type { PlanFeatureKey } from '../plan-features/plan-features'

/** How the panel and the URLs name a campaign. */
export const CAMPAIGN_KINDS = ['coverage_upgrade', 'quote_followup', 'renewal', 'winback', 'cross_sell'] as const
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number]

/** A piece of the message that changes per client: written {key} by the office, {{n}} for Meta. */
export interface CampaignPlaceholder {
  key: string
  label: string
  /** What Meta's reviewer reads in its place, and what the panel's preview shows. */
  example: string
}

export interface CampaignSettingField {
  key: string
  label: string
  /**
   * number: a whole number (days, pesos); codes: coverage codes ("A", "B1");
   * days: a list of whole days, longest first, that may be empty; options: some
   * of `options`, at least one.
   */
  type: 'number' | 'codes' | 'days' | 'options'
  min?: number
  max?: number
  options?: Array<{ value: string; label: string }>
  help: string
}

export type CampaignSettings = Record<string, number | string[] | number[]>

/**
 * What the office can narrow a campaign's list by, besides the code or number
 * and the search. `gap` is what the client lacks: a protection (Mejora de
 * coberturas) or a product (Venta cruzada).
 */
export type CampaignFilter = 'coverage' | 'reason' | 'gap'

/** What a vehicle's coverage leaves out, or its insured sum to review (Mejora de coberturas). */
export const COVERAGE_GAPS = ['robo', 'granizo', 'cristales', 'suma'] as const
export type CoverageGap = (typeof COVERAGE_GAPS)[number]

/** The products Venta cruzada offers to who does not have them. */
export const CROSS_SELL_PRODUCTS = ['home', 'life', 'vehicle', 'commercial'] as const
export type CrossSellProduct = (typeof CROSS_SELL_PRODUCTS)[number]

export const GAP_LABELS: Record<CoverageGap | CrossSellProduct, string> = {
  robo: 'Robo',
  granizo: 'Granizo',
  cristales: 'Cristales',
  suma: 'Suma asegurada a revisar',
  home: 'Hogar',
  life: 'Vida y accidentes personales',
  vehicle: 'Auto o moto',
  commercial: 'Comercio',
}

/** Why a policy was lost, grouped as the office reads it (Bajas y anulaciones): Triunfo's cancellation, or it ran out unrenewed. */
export const CANCELLATION_REASONS = [
  'falta_pago',
  'venta',
  'desistimiento',
  'costo',
  'cambio_compania',
  'siniestro',
  'rescision',
  'no_renovada',
  'otros',
] as const
export type CancellationReason = (typeof CANCELLATION_REASONS)[number]

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  falta_pago: 'Falta de pago',
  venta: 'Venta del bien',
  desistimiento: 'La pidió el asegurado',
  costo: 'Aumento de costo',
  cambio_compania: 'Cambio de compañía',
  siniestro: 'Siniestro',
  rescision: 'Rescisión',
  no_renovada: 'Venció y no se renovó',
  otros: 'Otros motivos',
}

export interface CampaignDefinition {
  kind: CampaignKind
  dbKind: SalesCampaignKind
  feature: PlanFeatureKey
  label: string
  description: string
  /** The template name without its version (Meta: lowercase letters, digits and _). */
  templateSlug: string
  placeholders: CampaignPlaceholder[]
  defaultBody: string
  settingFields: CampaignSettingField[]
  defaultSettings: CampaignSettings
  filters: CampaignFilter[]
}

const NOMBRE: CampaignPlaceholder = { key: 'nombre', label: 'Nombre', example: 'Juan' }
const PORCENTAJE: CampaignPlaceholder = { key: 'porcentaje', label: 'Porcentaje', example: '15' }
const BIEN: CampaignPlaceholder = { key: 'bien', label: 'Vehículo o bien', example: 'Ford Ka' }
const VENCIMIENTO: CampaignPlaceholder = { key: 'vencimiento', label: 'Vencimiento', example: '30/11/2026' }

/** How long a client who got (or was marked for) a campaign is left out of it. */
const COOLDOWN: CampaignSettingField = {
  key: 'cooldownDays',
  label: 'No repetir antes de (días)',
  type: 'number',
  min: 7,
  max: 365,
  help: 'A quien ya se le escribió por esta campaña no se le vuelve a ofrecer hasta que pasen estos días.',
}

/**
 * The five campaigns of Nico's proposal (GENERACION Y GESTION DE VENTAS,
 * 2026-11-03). The default texts follow his examples; each organization
 * rewrites them in the panel.
 */
export const CAMPAIGNS: Record<CampaignKind, CampaignDefinition> = {
  coverage_upgrade: {
    kind: 'coverage_upgrade',
    dbKind: SalesCampaignKind.COVERAGE_UPGRADE,
    feature: 'campaign_coverage_upgrade',
    label: 'Mejora de coberturas',
    description:
      'Autos y motos vigentes con una cobertura que se puede mejorar o una suma asegurada baja, para ofrecerles una protección más completa.',
    templateSlug: 'campana_mejora_cobertura',
    placeholders: [NOMBRE, BIEN, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Estamos revisando opciones para mejorar la protección de tu {bien}. Podemos prepararte una propuesta para ampliar tu cobertura y, si la compañía lo permite, aplicar un beneficio del {porcentaje}%. ¿Querés que te enviemos alternativas sin compromiso?',
    settingFields: [
      {
        key: 'basicCoverages',
        label: 'Coberturas a mejorar',
        type: 'codes',
        help: 'Códigos de cobertura separados por coma, como figuran en la cartera (A, B, B1, C2, C2 Full). A quien tiene una de estas se le ofrece la siguiente: por ejemplo C2 → C Full, C Full → Todo Riesgo (D3).',
      },
      {
        key: 'reviewSumBelow',
        label: 'Revisar sumas aseguradas menores a ($)',
        type: 'number',
        min: 0,
        max: 999_999_999,
        help: 'También aparecen los vehículos asegurados por menos de este importe, tengan la cobertura que tengan. 0 = no revisar sumas.',
      },
      COOLDOWN,
    ],
    // C2 and C2 Full (the cartera's name for C7) since 2026-11-10: the office moves C2 to C Full and C Full to D3.
    defaultSettings: { basicCoverages: ['A', 'B', 'B1', 'C2', 'C2 Full'], reviewSumBelow: 0, cooldownDays: 90 },
    filters: ['coverage', 'gap'],
  },
  quote_followup: {
    kind: 'quote_followup',
    dbKind: SalesCampaignKind.QUOTE_FOLLOWUP,
    feature: 'campaign_quote_followup',
    label: 'Cotizaciones sin cerrar',
    description:
      'Personas que cotizaron con el bot, o pidieron contratar desde la web o el bot, y no terminaron con una póliza.',
    templateSlug: 'campana_cotizacion_sin_cerrar',
    placeholders: [NOMBRE, BIEN, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Hace unos días cotizaste el seguro de tu {bien} con nosotros y queríamos saber si pudiste revisarlo. Podemos actualizar la cotización, ver otras alternativas y consultar si aplica un beneficio del {porcentaje}%. ¿Querés que la retomemos?',
    settingFields: [
      {
        key: 'afterDays',
        label: 'Escribir desde (días después de cotizar)',
        type: 'number',
        min: 1,
        max: 30,
        help: 'Cuántos días después de la cotización aparece en la lista.',
      },
      {
        key: 'withinDays',
        label: 'Hasta (días después de cotizar)',
        type: 'number',
        min: 2,
        max: 180,
        help: 'Después de estos días la cotización ya no aparece.',
      },
      {
        key: 'secondContactDays',
        label: 'Segundo contacto si no responde (días)',
        type: 'number',
        min: 0,
        max: 60,
        help: 'A quien no respondió el primer mensaje se lo vuelve a ofrecer una sola vez, pasados estos días. 0 = sin segundo contacto.',
      },
      COOLDOWN,
    ],
    defaultSettings: { afterDays: 2, withinDays: 30, secondContactDays: 5, cooldownDays: 30 },
    filters: [],
  },
  renewal: {
    kind: 'renewal',
    dbKind: SalesCampaignKind.RENEWAL,
    feature: 'campaign_renewal',
    label: 'Renovaciones',
    description: 'Pólizas vigentes que vencen pronto y todavía no tienen la renovación emitida.',
    templateSlug: 'campana_renovacion',
    placeholders: [NOMBRE, BIEN, VENCIMIENTO, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! El seguro de tu {bien} vence el {vencimiento}. Queremos ayudarte a revisar las alternativas para que mantengas la protección que necesitás, y consultar si tu renovación califica para un beneficio del {porcentaje}%. ¿Querés que revisemos las opciones?',
    settingFields: [
      {
        key: 'daysBefore',
        label: 'Avisar desde (días antes del vencimiento)',
        type: 'number',
        min: 1,
        max: 90,
        help: 'Aparecen las pólizas que vencen dentro de estos días.',
      },
      {
        key: 'reminderDays',
        label: 'Recordar de nuevo cuando falten (días)',
        type: 'days',
        min: 1,
        max: 89,
        help: 'A quien no respondió se lo vuelve a ofrecer cuando falten estos días para el vencimiento (por ejemplo 15, 7). Vacío = un solo aviso.',
      },
      COOLDOWN,
    ],
    defaultSettings: { daysBefore: 30, reminderDays: [15, 7], cooldownDays: 60 },
    filters: [],
  },
  winback: {
    kind: 'winback',
    dbKind: SalesCampaignKind.WINBACK,
    feature: 'campaign_winback',
    label: 'Bajas y anulaciones',
    description:
      'Pólizas anuladas, dadas de baja o vencidas sin renovar de clientes que no tienen otra vigente por el mismo bien.',
    templateSlug: 'campana_recuperacion',
    placeholders: [NOMBRE, BIEN, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Queríamos saber si podemos ayudarte a encontrar una nueva alternativa de seguro para tu {bien}. Si te interesa, revisamos opciones en distintas compañías y te preparamos una propuesta, con un beneficio del {porcentaje}% si la cotización califica. ¿Te gustaría?',
    settingFields: [
      {
        key: 'withinDays',
        label: 'Anuladas o vencidas en los últimos (días)',
        type: 'number',
        min: 7,
        max: 365,
        help: 'Aparecen las pólizas anuladas, o vencidas sin renovar, dentro de estos días.',
      },
      COOLDOWN,
    ],
    defaultSettings: { withinDays: 180, cooldownDays: 90 },
    filters: ['reason'],
  },
  cross_sell: {
    kind: 'cross_sell',
    dbKind: SalesCampaignKind.CROSS_SELL,
    feature: 'campaign_cross_sell',
    label: 'Venta cruzada',
    description: 'Clientes con un seguro vigente a los que les falta otro de los productos que ofrecés.',
    templateSlug: 'campana_venta_cruzada',
    placeholders: [NOMBRE, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Además de tu seguro actual, tenemos alternativas para proteger otras cosas importantes, como tu hogar o tu familia. Por ser cliente, podemos prepararte una cotización y consultar si corresponde un beneficio del {porcentaje}%. ¿Te gustaría conocer las opciones?',
    settingFields: [
      {
        key: 'offer',
        label: 'Productos para ofrecer',
        type: 'options',
        options: CROSS_SELL_PRODUCTS.map(value => ({ value, label: GAP_LABELS[value] })),
        help: 'Aparecen los clientes con un seguro vigente a los que les falta alguno de estos productos.',
      },
      COOLDOWN,
    ],
    defaultSettings: { offer: ['home', 'life', 'vehicle'], cooldownDays: 120 },
    filters: ['coverage', 'gap'],
  },
}

export function campaignOf(kind: string): CampaignDefinition {
  const definition = CAMPAIGNS[kind as CampaignKind]
  if (!definition) throw new BadRequestException(`La campaña ${kind} no existe.`)
  return definition
}

export function campaignOfDbKind(dbKind: SalesCampaignKind): CampaignDefinition {
  return Object.values(CAMPAIGNS).find(c => c.dbKind === dbKind)!
}

/** Meta's limit for a template body. */
const MAX_BODY = 1024
const PLACEHOLDER_RE = /\{([a-zA-Z_áéíóú]+)\}/g

/** The placeholders of a body, in order, each occurrence apart (Meta numbers every one). */
export function placeholdersIn(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER_RE)].map(m => m[1])
}

/**
 * A body the office wrote, checked against what Meta rejects outright: too
 * long, a placeholder the campaign does not know, a variable first or last,
 * or two variables in a row.
 */
export function validateBody(definition: CampaignDefinition, raw: string): string {
  const body = raw.replace(/\r\n/g, '\n').trim()
  if (!body) throw new BadRequestException('El mensaje no puede quedar vacío.')
  if (body.length > MAX_BODY) throw new BadRequestException(`El mensaje no puede pasar los ${MAX_BODY} caracteres.`)
  if (/\n{3,}/.test(body))
    throw new BadRequestException('El mensaje no puede tener más de una línea en blanco seguida.')
  const allowed = new Set(definition.placeholders.map(p => p.key))
  for (const key of placeholdersIn(body)) {
    if (!allowed.has(key)) {
      const list = definition.placeholders.map(p => `{${p.key}}`).join(', ')
      throw new BadRequestException(`{${key}} no es un dato que esta campaña conozca. Podés usar ${list}.`)
    }
  }
  if (/^\{[^}]+\}/.test(body) || /\{[^}]+\}$/.test(body)) {
    throw new BadRequestException('El mensaje no puede empezar ni terminar con un dato variable: Meta lo rechaza.')
  }
  if (/\}\s*\{/.test(body)) {
    throw new BadRequestException('Dos datos variables seguidos no se pueden: poné texto entre ellos.')
  }
  if (/[{}]/.test(body.replace(PLACEHOLDER_RE, ''))) {
    throw new BadRequestException('Las llaves { } solo van alrededor de un dato variable, como {nombre}.')
  }
  return body
}

/** The body as Meta wants it: {{1}}, {{2}}... in order of appearance. */
export function toTemplateText(body: string): string {
  let n = 0
  return body.replace(PLACEHOLDER_RE, () => `{{${++n}}}`)
}

/** The values of a body's variables, in the order of its {{n}}. */
export function templateParams(body: string, values: Record<string, string>): string[] {
  return placeholdersIn(body).map(key => values[key] ?? '')
}

/** The body with each placeholder replaced: what the client reads, and what the chat stores. */
export function renderBody(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (_, key: string) => values[key] ?? '')
}

/** The examples Meta's reviewer reads in place of the variables. */
export function exampleValues(definition: CampaignDefinition): Record<string, string> {
  return Object.fromEntries(definition.placeholders.map(p => [p.key, p.example]))
}

/** The campaign's settings: what the office changed over the defaults. */
export function settingsOf(definition: CampaignDefinition, stored: unknown): CampaignSettings {
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  const result: CampaignSettings = { ...definition.defaultSettings }
  for (const field of definition.settingFields) {
    const value = map[field.key]
    if (field.type === 'number' && typeof value === 'number') result[field.key] = value
    if (field.type === 'codes' && Array.isArray(value)) result[field.key] = value.filter(v => typeof v === 'string')
    if (field.type === 'days' && Array.isArray(value)) result[field.key] = value.filter(v => typeof v === 'number')
    if (field.type === 'options' && Array.isArray(value)) {
      const known = value.filter(v => field.options?.some(o => o.value === v))
      if (known.length) result[field.key] = known as string[]
    }
  }
  return result
}

/** The office's settings change, checked field by field. */
export function withSettings(
  definition: CampaignDefinition,
  stored: unknown,
  changes: Record<string, unknown>,
): CampaignSettings {
  const result = settingsOf(definition, stored)
  for (const [key, value] of Object.entries(changes)) {
    const field = definition.settingFields.find(f => f.key === key)
    if (!field) throw new BadRequestException(`La campaña ${definition.label} no tiene el ajuste ${key}.`)
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new BadRequestException(`${field.label}: tiene que ser un número entero.`)
      }
      if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        throw new BadRequestException(`${field.label}: tiene que estar entre ${field.min} y ${field.max}.`)
      }
      result[key] = value
    } else if (field.type === 'days') {
      const days = Array.isArray(value) ? value : []
      if (days.length > 5 || days.some(d => typeof d !== 'number' || !Number.isInteger(d))) {
        throw new BadRequestException(`${field.label}: escribí hasta 5 números enteros de días, separados por coma.`)
      }
      const clean = [...new Set(days as number[])].sort((a, b) => b - a)
      if (clean.some(d => (field.min !== undefined && d < field.min) || (field.max !== undefined && d > field.max))) {
        throw new BadRequestException(`${field.label}: cada uno tiene que estar entre ${field.min} y ${field.max}.`)
      }
      result[key] = clean
    } else if (field.type === 'options') {
      const picked = Array.isArray(value) ? value : []
      const clean = (field.options ?? []).map(o => o.value).filter(v => picked.includes(v))
      if (!clean.length || clean.length !== new Set(picked).size) {
        throw new BadRequestException(`${field.label}: elegí al menos una de las opciones.`)
      }
      result[key] = clean
    } else {
      const codes = Array.isArray(value) ? value : []
      const clean = [...new Set(codes.map(c => (typeof c === 'string' ? c.trim().toUpperCase() : '')))].filter(Boolean)
      if (!clean.length || clean.length > 20 || clean.some(c => c.length > 10)) {
        throw new BadRequestException(`${field.label}: escribí entre 1 y 20 códigos de cobertura.`)
      }
      result[key] = clean
    }
  }
  if (
    definition.kind === 'quote_followup' &&
    typeof result.afterDays === 'number' &&
    typeof result.withinDays === 'number' &&
    result.withinDays <= result.afterDays
  ) {
    throw new BadRequestException('"Hasta" tiene que ser más días que "Escribir desde".')
  }
  return result
}

export function numberSetting(settings: CampaignSettings, key: string): number {
  const value = settings[key]
  return typeof value === 'number' ? value : 0
}

export function codesSetting(settings: CampaignSettings, key: string): string[] {
  const value = settings[key]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function daysSetting(settings: CampaignSettings, key: string): number[] {
  const value = settings[key]
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []
}
