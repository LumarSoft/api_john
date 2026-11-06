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
  /** number: whole days; codes: coverage codes ("A", "B1"). */
  type: 'number' | 'codes'
  min?: number
  max?: number
  help: string
}

export type CampaignSettings = Record<string, number | string[]>

/** What the office can narrow a campaign's list by, besides the code or number and the search. */
export type CampaignFilter = 'coverage' | 'reason'

/** Why Triunfo cancelled a policy, grouped as the office reads it (Bajas y anulaciones). */
export const CANCELLATION_REASONS = [
  'falta_pago',
  'venta',
  'desistimiento',
  'costo',
  'cambio_compania',
  'siniestro',
  'rescision',
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
    description: 'Autos y motos vigentes con una cobertura básica, para ofrecerles una más completa.',
    templateSlug: 'campana_mejora_cobertura',
    placeholders: [NOMBRE, BIEN, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Estamos revisando opciones para mejorar la protección de tu {bien}. Podemos prepararte una propuesta para ampliar tu cobertura y, si la compañía lo permite, aplicar un beneficio del {porcentaje}%. ¿Querés que te enviemos alternativas sin compromiso?',
    settingFields: [
      {
        key: 'basicCoverages',
        label: 'Coberturas que cuentan como básicas',
        type: 'codes',
        help: 'Códigos de cobertura separados por coma (por ejemplo A, B, B1).',
      },
      COOLDOWN,
    ],
    defaultSettings: { basicCoverages: ['A', 'B', 'B1'], cooldownDays: 90 },
    filters: ['coverage'],
  },
  quote_followup: {
    kind: 'quote_followup',
    dbKind: SalesCampaignKind.QUOTE_FOLLOWUP,
    feature: 'campaign_quote_followup',
    label: 'Cotizaciones sin cerrar',
    description: 'Personas que cotizaron con el bot y no siguieron con la contratación.',
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
      COOLDOWN,
    ],
    defaultSettings: { afterDays: 2, withinDays: 30, cooldownDays: 30 },
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
      COOLDOWN,
    ],
    defaultSettings: { daysBefore: 30, cooldownDays: 60 },
    filters: [],
  },
  winback: {
    kind: 'winback',
    dbKind: SalesCampaignKind.WINBACK,
    feature: 'campaign_winback',
    label: 'Bajas y anulaciones',
    description: 'Pólizas anuladas o dadas de baja de clientes que no tienen otra vigente por el mismo bien.',
    templateSlug: 'campana_recuperacion',
    placeholders: [NOMBRE, BIEN, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Queríamos saber si podemos ayudarte a encontrar una nueva alternativa de seguro para tu {bien}. Si te interesa, revisamos opciones en distintas compañías y te preparamos una propuesta, con un beneficio del {porcentaje}% si la cotización califica. ¿Te gustaría?',
    settingFields: [
      {
        key: 'withinDays',
        label: 'Anuladas en los últimos (días)',
        type: 'number',
        min: 7,
        max: 365,
        help: 'Aparecen las pólizas anuladas dentro de estos días.',
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
    description: 'Clientes con el seguro de un auto o una moto vigente y sin seguro de hogar.',
    templateSlug: 'campana_venta_cruzada',
    placeholders: [NOMBRE, PORCENTAJE],
    defaultBody:
      '¡Hola, {nombre}! Además de tu seguro actual, tenemos alternativas para proteger otras cosas importantes, como tu hogar o tu familia. Por ser cliente, podemos prepararte una cotización y consultar si corresponde un beneficio del {porcentaje}%. ¿Te gustaría conocer las opciones?',
    settingFields: [COOLDOWN],
    defaultSettings: { cooldownDays: 120 },
    filters: ['coverage'],
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
  return Array.isArray(value) ? value : []
}
