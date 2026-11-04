import { BlockedClaimReason } from 'generated/prisma/client'

/** How the bot opens the handoff reason of a claim it refused to file (since 2026-10-05). */
const BLOCKED_CLAIM_PREFIX = 'denuncia de siniestro no registrada'

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Why the bot stopped a claim, read from the handoff reason it wrote. Only for
 * handoffs that arrive without the explicit `blockedClaimReason` (a bot older
 * than the field); the migration filled the rows stored before it the same
 * way. A reason the office merged other requests into is read from its last
 * stopped claim. Anything else: null.
 */
export function blockedClaimReasonFromText(reason?: string | null): BlockedClaimReason | null {
  const text = normalize(reason ?? '')
  const at = text.lastIndexOf(BLOCKED_CLAIM_PREFIX)
  if (at < 0) return null
  const end = text.indexOf('\n\n', at)
  const segment = text.slice(at, end < 0 ? undefined : end)
  if (/\b(cobro|pago) rechazado\b/.test(segment)) return BlockedClaimReason.REJECTED_PAYMENT
  if (/\bsaldo vencido\b|\bcuotas vencidas\b/.test(segment)) return BlockedClaimReason.OVERDUE_INSTALLMENTS
  if (/\bno tiene polizas vigentes\b|\bsin poliza vigente\b/.test(segment)) return BlockedClaimReason.NO_POLICY
  return null
}
