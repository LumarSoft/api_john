/**
 * The Meta template `aviso_poliza_vencida` (Utility, es_AR), kept here word
 * for word: the panel shows the notice as the client got it, and the bot
 * reads it back as the office's last message when they answer. The
 * organization's name is a variable so every organization sends its own.
 */
const NOTICE_TEMPLATE =
  'Hola {{1}}, te escribimos de {{2}}, tu productor de seguros. ' +
  'Tu póliza {{3}} ({{4}}) venció el {{5}}. ' +
  'Si querés renovarla o cotizar otra opción, respondé este mensaje y te ayudamos.'

export interface ExpiryNoticeData {
  clientFirstName: string
  organizationName: string
  certificateNumber: string
  /** What the policy covered, as the client knows it: the plate, else the product or risk. */
  item: string
  validTo: Date
}

/** Body variables {{1}}…{{5}} of the template, in order. */
export function expiryNoticeParams(data: ExpiryNoticeData): string[] {
  return [
    titleCase(data.clientFirstName.split(/\s+/)[0] || data.clientFirstName),
    data.organizationName,
    data.certificateNumber,
    data.item,
    formatDate(data.validTo),
  ].map(metaSafe)
}

/** The notice as the client reads it. */
export function renderExpiryNotice(params: string[]): string {
  return NOTICE_TEMPLATE.replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '')
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase())
}

/** dd/mm/yyyy of a date-only value (stored at UTC midnight). */
function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

/** Meta rejects template variables with new lines, tabs or runs of spaces. */
function metaSafe(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
