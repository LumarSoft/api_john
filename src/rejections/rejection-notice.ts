import { PaymentRejectionChannel } from 'generated/prisma/client'
import {
  latestVersion,
  NOTICE_TEMPLATES,
  renderTemplate,
  templateParams,
  type NoticeTemplateVersion,
} from '../notices/notice-templates'

/**
 * The Meta template of the payment-rejection notice (src/notices/notice-templates.ts).
 * Its first version named the first organization; the current one takes each
 * organization's name as a variable.
 */
export const REJECTION_TEMPLATE = NOTICE_TEMPLATES.payment_rejection

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
  /** How the notice names the organization (only the current version says it). */
  organizationName: string
  holderName: string
  clientFirstName?: string | null
  certificateNumber: string
  installmentNumber: number
  dueDate: Date
  amount: number
  reason: string
}

/** Body variables of the template version, in order. */
export function noticeParams(
  data: NoticeData,
  version: NoticeTemplateVersion = latestVersion(REJECTION_TEMPLATE),
): string[] {
  return templateParams(version, {
    firstName: greetingName(data.holderName, data.clientFirstName),
    organization: data.organizationName,
    installment: String(data.installmentNumber),
    certificate: data.certificateNumber,
    dueDate: formatDate(data.dueDate),
    amount: formatAmount(data.amount),
    reason: reasonForClient(data.reason),
  })
}

/** The notice as the client reads it. */
export function renderNotice(
  params: string[],
  version: NoticeTemplateVersion = latestVersion(REJECTION_TEMPLATE),
): string {
  return renderTemplate(version, params)
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
