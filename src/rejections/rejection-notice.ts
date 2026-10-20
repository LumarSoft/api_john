import { PaymentRejectionChannel } from 'generated/prisma/client'

/**
 * The approved Meta template `aviso_rechazo_pago` (Servicio, es_AR). Kept here
 * word for word: the panel shows the notice as the client got it, and the bot
 * reads it back as the office's last message when they answer.
 */
const NOTICE_TEMPLATE =
  'Hola {{1}}, te escribimos de JP Management Group, tu productor de seguros. ' +
  'Triunfo Seguros nos informó que no se pudo cobrar la cuota {{2}} de tu póliza {{3}} ' +
  '(vencimiento {{4}}, importe ${{5}}) por {{6}}. Para que tu cobertura no quede suspendida, ' +
  'respondé este mensaje y te ayudamos a regularizar el pago.'

/** Triunfo's reasons, as the client should read them after "por". */
const REASONS: Record<string, string> = {
  'FALTA DE FONDOS': 'falta de fondos en la cuenta',
  'CTA CERRADA O SUSPENDIDA': 'cuenta cerrada o suspendida',
  'MONEDA DIF. LA CTA DEL DEBITO': 'una cuenta en otra moneda',
  'CUENTA SIN DISPONIBLE': 'falta de saldo disponible en la tarjeta',
  'CUENTA S/DISPONIBLE': 'falta de saldo disponible en la tarjeta',
  'TARJETA AJENA AL SERVICIO': 'tarjeta no adherida al débito automático',
  'TARJETA TOKEN INEXISTENTE': 'un problema con los datos de la tarjeta',
  'EMISOR NO DISPONIBLE': 'un problema del emisor de la tarjeta',
}

/** A reason Triunfo sends in capitals, in words a client understands. */
export function reasonForClient(reason: string): string {
  const key = reason.trim().replace(/\s+/g, ' ').toUpperCase()
  return (
    REASONS[key] ??
    key
      .toLowerCase()
      .replace(/\bs\//g, 'sin ')
      .replace(/\bcta\b/g, 'cuenta')
  )
}

/** Cards say so in the entity ("VISA DEBITO", "TARJETA VISA"); anything else is a bank account. */
export function channelOf(entity: string): PaymentRejectionChannel {
  return /VISA|MASTER|TARJETA|AMEX|AMERICAN|CABAL|NARANJA/i.test(entity)
    ? PaymentRejectionChannel.CARD
    : PaymentRejectionChannel.ACCOUNT
}

/**
 * The name to greet with: the client's first name when the policy is in the
 * cartera, else the holder as Triunfo writes it (surname first, so all of it).
 */
export function greetingName(holderName: string, clientFirstName?: string | null): string {
  const first = clientFirstName?.trim().split(/\s+/)[0]
  return titleCase(first || holderName)
}

export interface NoticeData {
  holderName: string
  clientFirstName?: string | null
  certificateNumber: string
  installmentNumber: number
  dueDate: Date
  amount: number
  reason: string
}

/** Body variables {{1}}…{{6}} of the template, in order. */
export function noticeParams(data: NoticeData): string[] {
  return [
    greetingName(data.holderName, data.clientFirstName),
    String(data.installmentNumber),
    data.certificateNumber,
    formatDate(data.dueDate),
    formatAmount(data.amount),
    reasonForClient(data.reason),
  ].map(metaSafe)
}

/** The notice as the client reads it. */
export function renderNotice(params: string[]): string {
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

/** "90.315" or "90.315,50": the way amounts read in Argentina. */
function formatAmount(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0
  return amount.toLocaleString('es-AR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

/** Meta rejects template variables with new lines, tabs or runs of spaces. */
function metaSafe(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
