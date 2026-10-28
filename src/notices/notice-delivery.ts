import { HttpException } from '@nestjs/common'
import { whatsAppIds } from '../common/phone-match'

/**
 * Pause between notices. Meta caps throughput per number, and a burst of the
 * same template to dozens of people is what its quality checks flag as spam.
 */
export const SEND_GAP_MS = 1500

/** A WhatsApp number that can send, with the codes it serves. */
export interface Sender {
  phoneNumberId: string
  codeIds: number[]
}

/** What the platform wrote on its own in a chat, for the bot to tell from a person's reply. */
export type NoticeKind = 'payment_rejection' | 'policy_expiry'

/**
 * The first phone, in order of preference, that reads as one WhatsApp id. A
 * mobile whose `15` split is ambiguous counts only if one reading already
 * wrote to us.
 */
export function pickWhatsApp(
  phones: Array<string | null | undefined>,
  known: Set<string>,
): { phone: string; waId: string } | null {
  for (const phone of phones) {
    if (!phone) continue
    const ids = whatsAppIds(phone)
    const waId = ids.length === 1 ? ids[0] : ids.find(id => known.has(id))
    if (waId) return { phone, waId }
  }
  return null
}

/** The number the client already talks to, else one serving the policy's code, else the first. */
export function pickSender(senders: Sender[], current: string | null | undefined, codeId: number | null): string {
  if (current && senders.some(s => s.phoneNumberId === current)) return current
  const forCode = codeId != null ? senders.find(s => s.codeIds.includes(codeId)) : undefined
  return (forCode ?? senders[0]).phoneNumberId
}

/** Why WhatsApp did not take the notice, for the office. */
export function describeFailure(error: unknown): string {
  if (error instanceof HttpException && error.getStatus() === 502) return error.message.slice(0, 500)
  return 'No se pudo enviar: el bot no respondió. Probá de nuevo en unos minutos.'
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
