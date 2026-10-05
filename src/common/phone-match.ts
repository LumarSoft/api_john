/**
 * Argentine numbers arrive in two shapes that never compare equal as strings:
 * WhatsApp reports `549` + area + number (`5493413404951`) while Triunfo's
 * cartera stores the local mobile form with the `15` prefix (`341153404951`),
 * sometimes with a leading `0` or punctuation. Both reduce to the same 10-digit
 * national number (`3413404951`).
 */
function nationalCandidates(raw: string | null | undefined): string[] {
  let digits = (raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('54')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('9')) digits = digits.slice(1)
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length === 10) return [digits]
  // The mobile `15` sits after a 2–4 digit area code; which one is ambiguous
  // without an area-code table, so every split is a candidate.
  if (digits.length === 12) {
    return [2, 3, 4]
      .filter(at => digits.slice(at, at + 2) === '15')
      .map(at => digits.slice(0, at) + digits.slice(at + 2))
  }
  return []
}

/** True when a WhatsApp id and a stored phone are the same Argentine line. */
export function isSamePhone(waId: string | null | undefined, phone: string | null | undefined): boolean {
  const wa = nationalCandidates(waId)
  if (!wa.length) return false
  const stored = new Set(nationalCandidates(phone))
  return wa.some(candidate => stored.has(candidate))
}
