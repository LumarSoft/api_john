/**
 * Triunfo payment methods (`FormaPagoCod`) that may be shown to a client.
 *
 *   1 = Débito Automático
 *   9 = Plan de Pago
 *   6 = Contado — quoted by Triunfo but NOT shown, by client request.
 *
 * This is an allowlist on purpose: if Triunfo ever starts returning a new
 * payment method, it stays hidden until someone decides it should be offered.
 *
 * Applied in the two places that turn a raw Triunfo quote into what the web and
 * the bot display — `CotizadorService.normalizeResult` (live quote) and
 * `parseQuoteCoverages` in the solicitudes module (stored quote).
 */
export const VISIBLE_PAYMENT_METHOD_CODES = ['1', '9'] as const

export type VisiblePaymentMethodCode = (typeof VISIBLE_PAYMENT_METHOD_CODES)[number]

export const isVisiblePaymentMethod = (code?: string): boolean =>
  VISIBLE_PAYMENT_METHOD_CODES.includes(String(code ?? '').trim() as VisiblePaymentMethodCode)
