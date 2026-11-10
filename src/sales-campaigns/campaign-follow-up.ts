import { SalesOpportunityStatus } from 'generated/prisma/client'
import { CampaignDefinition, CampaignSettings, daysSetting, numberSetting } from './campaign-catalog'

const DAY_MS = 86_400_000

/**
 * Where a client stands in a campaign that writes more than once: which
 * contact comes next (`step` of `of`) and whether it is due now. A due
 * follow-up puts the client back on the office's to-do and lets the campaign
 * write again inside the cooldown.
 */
export interface FollowUp {
  step: number
  of: number
  due: boolean
  /** "Segundo contacto", "Recordatorio: faltan 7 días". */
  label: string
}

interface FollowUpInput {
  /** When the campaign wrote to this client (sent or marked as contacted), any order. */
  contacts: Date[]
  /** Where their opportunity stands; null when nobody opened one. */
  status: SalesOpportunityStatus | null
  /** RENEWAL: when the policy ends. */
  endsAt: Date | null
}

/**
 * The follow-up of someone the campaign already wrote to; null for a first
 * contact or a campaign that writes once. Only who has not answered is written
 * to again: a reply, a quote, a sale or the office closing it ends the series
 * (the document's "detener los mensajes cuando el cliente responde o contrata").
 *
 * - Cotizaciones sin cerrar: one second contact, `secondContactDays` after the first.
 * - Renovaciones: one reminder each time the days left cross one of
 *   `reminderDays` (30 → 15 → 7), counting the first notice as the first step.
 */
export function followUpOf(
  definition: CampaignDefinition,
  settings: CampaignSettings,
  input: FollowUpInput,
  now: Date,
): FollowUp | null {
  if (!input.contacts.length) return null
  const waiting = input.status === null || input.status === SalesOpportunityStatus.CONTACTED
  const last = Math.max(...input.contacts.map(c => c.getTime()))

  if (definition.kind === 'quote_followup') {
    const after = numberSetting(settings, 'secondContactDays')
    if (after <= 0) return null
    const cycleFrom = now.getTime() - numberSetting(settings, 'cooldownDays') * DAY_MS
    const inCycle = input.contacts.filter(c => c.getTime() >= cycleFrom).length
    // Outside the cooldown the list offers them as new: nothing to follow up.
    if (inCycle === 0) return null
    const due = inCycle === 1 && waiting && now.getTime() - last >= after * DAY_MS
    return { step: 2, of: 2, due, label: 'Segundo contacto' }
  }

  if (definition.kind === 'renewal' && input.endsAt) {
    const first = numberSetting(settings, 'daysBefore')
    const thresholds = [first, ...daysSetting(settings, 'reminderDays').filter(d => d < first)].sort((a, b) => b - a)
    if (thresholds.length < 2) return null
    const daysLeft = Math.max(0, Math.ceil((input.endsAt.getTime() - now.getTime()) / DAY_MS))
    const step = Math.max(1, thresholds.filter(t => t >= daysLeft).length)
    if (step < 2) return null
    // Last year's notice of the same client is not part of this renewal.
    const cycleFrom = input.endsAt.getTime() - first * DAY_MS
    if (last < cycleFrom) return null
    const stepFrom = input.endsAt.getTime() - thresholds[step - 1] * DAY_MS
    const due = waiting && last < stepFrom
    return {
      step,
      of: thresholds.length,
      due,
      label: `Recordatorio: ${daysLeft === 1 ? 'falta 1 día' : `faltan ${daysLeft} días`}`,
    }
  }

  return null
}

/**
 * A reply that asks not to be written to again ("no me escriban más", "no
 * quiero recibir publicidad", "dejen de mandarme mensajes", "STOP"). Requests
 * only: "no me mandaron la póliza" or "quiero dar de baja el seguro" are not.
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bno (me )?(escriban?|escribas|escribir|manden?|mandes|mandar|envien?|envies|enviar|contacten?|contactes|contactar|llamen?|llames|llamar|molesten?|molestes|molestar)\b.{0,25}\bmas\b/,
  /\bno (quiero|deseo|me interesa) (recibir|que me (escriban|manden|envien|contacten|llamen|molesten))\b/,
  /\bdej(en|a|ame|enme|ar) de (escribir|mandar|enviar|molestar|contactar|llamar)/,
  /\bno me molest(en|es)\b/,
  /\b(sacame|saquenme|borrame|borrenme|eliminame|eliminenme|denme de baja|dame de baja|darme de baja|quiero la baja)\b.{0,40}\b(lista|mensajes?|publicidad|promocion(es)?|difusion|contactos?)\b/,
  /^\W*(stop|no molestar|unsubscribe|basta de mensajes)\W*$/,
]

export function isOptOutRequest(text: string | null | undefined): boolean {
  const plain = (text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain || plain.length > 300) return false
  return OPT_OUT_PATTERNS.some(pattern => pattern.test(plain))
}
