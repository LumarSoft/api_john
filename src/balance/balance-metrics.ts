/**
 * What each monthly balance metric means. One `MonthlyBalance` row per producer
 * code per month (Argentina time); timestamps are matched by the month in
 * Argentina, Triunfo's date-only policy dates by the calendar days of the month.
 *
 * Portfolio
 * - policiesInForce: policies not cancelled by Triunfo that started on or before
 *   the last day of the month and still run after it (validTo ≥ 1st of next month).
 * - policiesNew: policies whose first term starts in the month (the cartera sync
 *   never moves validFrom, so a renewal keeps its original start).
 * - policiesLost: policies not cancelled whose term ended in the month and were
 *   not renewed (a renewal moves validTo forward).
 * - premiumInForce: sum of the premium of the policies in force (month-end only).
 * Collections (month-end only, cuotas of policies Triunfo did not cancel, as the dashboard)
 * - debtAmount: what the pending, overdue and rejected cuotas add up to (credits left out).
 * - installmentsOverdue / installmentsRejected: cuotas in that state.
 * Claims
 * - claimsFiled: claims filed in the month (bot, portal or panel).
 * - claimsOpen: claims pending or in progress (month-end only).
 * - claimsBlockedNoPolicy / claimsBlockedRejectedPayment / claimsBlockedOverdue:
 *   "denuncias frenadas", claims the bot refused to file and sent to the office.
 * Sales
 * - quotesBot / quotesWeb: Triunfo quotes made in the month through a WhatsApp
 *   number / through the web or the panel.
 * - quoteRequests: coverage requests made on a quote in the month.
 * - contactLeads: advisor-contact leads (products without an online quote).
 * - requestsClosed: of the quote requests and leads of the month, those marked
 *   closed when the month ended (month-end only).
 * Attention
 * - handoffs: requests for a person (each matter once; one the customer added to stays one).
 * - conversationsNew: WhatsApp chats that started in the month.
 * - messagesSent: messages the platform sent on the organization's numbers (UsageMonthly).
 * - rejectionNoticesSent / expiryNoticesSent: rejected-payment and expired-policy
 *   notices sent by WhatsApp in the month.
 *
 * Month-end only metrics describe the state at the close and are only recorded
 * by a snapshot taken right after it. A month rebuilt after the fact
 * (`backfilled`) stores them as null, never as 0.
 *
 * Handoffs and stopped claims count soft-deleted notifications too: clearing
 * "Asuntos pendientes" or deleting a chat hides the matter from the worklist,
 * it does not undo the request.
 */
export const BALANCE_METRICS = [
  'policiesInForce',
  'policiesNew',
  'policiesLost',
  'premiumInForce',
  'debtAmount',
  'installmentsOverdue',
  'installmentsRejected',
  'claimsFiled',
  'claimsOpen',
  'claimsBlockedNoPolicy',
  'claimsBlockedRejectedPayment',
  'claimsBlockedOverdue',
  'quotesBot',
  'quotesWeb',
  'quoteRequests',
  'contactLeads',
  'requestsClosed',
  'handoffs',
  'conversationsNew',
  'messagesSent',
  'rejectionNoticesSent',
  'expiryNoticesSent',
] as const

export type BalanceMetric = (typeof BALANCE_METRICS)[number]

/** One value per metric; null = not recorded. */
export type BalanceValues = Record<BalanceMetric, number | null>

/** The state at the close of the month: unknown for a month rebuilt after the fact. */
export const MONTH_END_METRICS: ReadonlySet<BalanceMetric> = new Set<BalanceMetric>([
  'premiumInForce',
  'debtAmount',
  'installmentsOverdue',
  'installmentsRejected',
  'claimsOpen',
  'requestsClosed',
])

/** Amounts in pesos (2 decimals); every other metric is a count. */
export const MONEY_METRICS: ReadonlySet<BalanceMetric> = new Set<BalanceMetric>(['premiumInForce', 'debtAmount'])

/** Empty values for a month: 0 for what is counted, null for what cannot be read. */
export function emptyValues(monthEnd: boolean): BalanceValues {
  return Object.fromEntries(
    BALANCE_METRICS.map(metric => [metric, monthEnd || !MONTH_END_METRICS.has(metric) ? 0 : null]),
  ) as BalanceValues
}

/**
 * Who a record of the month is credited to, so the balance can be split by the
 * codes a user sees. Every record lands on one of the organization's codes:
 * its own code; else the code billed for the number it came through; else the
 * master code (the office line, like everything that came through no number).
 */
export interface CodeAttribution {
  codeIds: ReadonlySet<number>
  masterCodeId: number
  /** Meta phone_number_id → responsible code (Conversation, Notification, Quote, ContactLead). */
  byMetaNumber: ReadonlyMap<string, number | null>
  /** PhoneNumber.id → responsible code (UsageMonthly). */
  byNumberId: ReadonlyMap<number, number | null>
}

export interface AttributedRecord {
  producerCodeId?: number | null
  metaPhoneNumberId?: string | null
  phoneNumberId?: number | null
}

/**
 * The code a record is credited to (see CodeAttribution). `numberFirst` is for
 * quotes: their code is a default (the master code) while the number they came
 * through says which branch quoted.
 */
export function attributeCode(ctx: CodeAttribution, record: AttributedRecord, numberFirst = false): number {
  const own = record.producerCodeId != null && ctx.codeIds.has(record.producerCodeId) ? record.producerCodeId : null
  const numberCode =
    record.metaPhoneNumberId != null
      ? ctx.byMetaNumber.get(record.metaPhoneNumberId)
      : record.phoneNumberId != null
        ? ctx.byNumberId.get(record.phoneNumberId)
        : null
  const byNumber = numberCode != null && ctx.codeIds.has(numberCode) ? numberCode : null
  return (numberFirst ? (byNumber ?? own) : (own ?? byNumber)) ?? ctx.masterCodeId
}

/** The month's values per code, as the snapshot adds records up. */
export class BalanceTally {
  private readonly values = new Map<number, BalanceValues>()

  constructor(
    private readonly ctx: CodeAttribution,
    monthEnd: boolean,
  ) {
    for (const codeId of ctx.codeIds) this.values.set(codeId, emptyValues(monthEnd))
  }

  /** Adds `amount` to a metric of the record's code. A metric not recorded this month stays null. */
  add(metric: BalanceMetric, record: AttributedRecord, amount = 1, numberFirst = false): void {
    const row = this.values.get(attributeCode(this.ctx, record, numberFirst))
    const current = row?.[metric]
    if (row && current != null) row[metric] = current + amount
  }

  /** Per code, money rounded to cents. */
  result(): Map<number, BalanceValues> {
    for (const row of this.values.values()) {
      for (const metric of MONEY_METRICS) {
        const value = row[metric]
        if (value != null) row[metric] = Math.round(value * 100) / 100
      }
    }
    return this.values
  }
}
