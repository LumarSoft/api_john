import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ToolError } from './tool.types'

type Args = Record<string, unknown>

/** A trimmed string argument, or undefined when absent or blank. */
export function optionalText(args: Args, key: string): string | undefined {
  const value = args[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function requiredText(args: Args, key: string, what: string): string {
  const value = optionalText(args, key)
  if (!value) throw new ToolError(`Falta ${what}.`)
  return value
}

export function optionalInt(args: Args, key: string): number | undefined {
  const value = args[key]
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) ? number : undefined
}

export function requiredInt(args: Args, key: string, what: string): number {
  const value = optionalInt(args, key)
  if (value === undefined) throw new ToolError(`Falta ${what} (un número entero).`)
  return value
}

export function optionalBool(args: Args, key: string): boolean | undefined {
  const value = args[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Validates a payload with the endpoint's own DTO, so the assistant can only
 * propose what the panel's form would accept. The model gets the messages.
 */
export async function assertValidDto<T extends object>(dto: new () => T, payload: object): Promise<T> {
  const instance = plainToInstance(dto, payload)
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true })
  if (errors.length) {
    const messages = errors.flatMap(e => Object.values(e.constraints ?? {}))
    throw new ToolError(`Los datos no son válidos: ${messages.join('; ') || 'revisá los valores'}.`)
  }
  return instance
}

const MAX_TEXT = 280
const MAX_ITEMS = 15

/**
 * A service's answer made small for the model: no nulls or empty values, long
 * texts cut, lists capped (with how many there were). Field names stay as they
 * are: the model reads them fine.
 */
export function compact(value: unknown, depth = 0): unknown {
  if (value == null) return undefined
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map(item => compact(item, depth + 1))
      .filter(v => v !== undefined)
    return value.length > MAX_ITEMS ? { primeros: items, total: value.length } : items
  }
  if (typeof value === 'object') {
    if (depth > 4) return undefined
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => [key, compact(v, depth + 1)] as const)
      .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value
}

const CBU_BANK_WEIGHTS = [7, 1, 3, 9, 7, 1, 3]
const CBU_ACCOUNT_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, i) => total + weight * Number(digits[i]), 0)
  return (10 - (sum % 10)) % 10
}

/**
 * A CBU or CVU as written by someone: 22 digits whose two check digits (end of
 * each block) match. Spaces and dashes are ignored.
 */
export function cbuProblem(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d{22}$/.test(digits)) return 'El CBU o CVU tiene que tener 22 números.'
  const bankOk = checkDigit(digits.slice(0, 7), CBU_BANK_WEIGHTS) === Number(digits[7])
  const accountOk = checkDigit(digits.slice(8, 21), CBU_ACCOUNT_WEIGHTS) === Number(digits[21])
  return bankOk && accountOk ? null : 'El CBU no pasa el control de dígitos: puede tener un número mal tipeado.'
}

export function normalizeCbu(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

/** An alias as banks accept it: 6 to 20 letters, numbers, dots or dashes. */
export function aliasProblem(alias: string): string | null {
  return /^[a-zA-Z0-9.-]{6,20}$/.test(alias)
    ? null
    : 'El alias tiene que tener entre 6 y 20 caracteres: letras, números, puntos o guiones.'
}

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
}

type Shift = { from: string; to: string }

/** "09:00–13:00 y 16:00–20:00", or "Cerrado". */
export function shiftsText(shifts: Shift[] | undefined): string {
  return shifts?.length ? shifts.map(s => `${s.from}–${s.to}`).join(' y ') : 'Cerrado'
}

/** A day-by-day reading of a weekly schedule, for the model and the cards. */
export function scheduleText(weekly: Partial<Record<string, Shift[]>> | null | undefined): Record<string, string> {
  return Object.fromEntries(DAY_KEYS.map(day => [DAY_LABELS[day], shiftsText(weekly?.[day])]))
}

/** What the person would read as a value in a card: "—" when empty. */
export function shown(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value
}

/** Today in Argentina as YYYY-MM-DD. */
export function todayIso(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}
