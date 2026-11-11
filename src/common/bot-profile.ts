/**
 * What the bot says that changes from one organization to another: how it
 * names the organization, the grúa and claims lines, the account an
 * installment can be transferred to and where cash is paid with the coupon.
 * Stored flat in Producer.botProfile and edited from "Configuración".
 */
export interface BotProfile {
  /** How the bot names the organization: "John Pellegrini Management Group". */
  orgName: string | null
  /** Short form shown next to it: "JPMG". */
  orgShortName: string | null
  /** Full legal name the model introduces itself with: "… SRL". */
  orgLegalName: string | null
  /** Grúa / assistance line the bot gives 24 hs. */
  towTruckPhone: string | null
  /** Line to report a claim by phone. Null → the bot gives Triunfo's. */
  claimsPhone: string | null
  /** Where cash is paid with the coupon: "Rapipago, Pago Fácil o Santa Fe Servicios". */
  cashPaymentPlaces: string | null
  /**
   * TRANSFER_BY_OFFICE: the bot gives no account at all and the office passes
   * the data in the chat (Roldán's office does not hand out an alias). Null:
   * the account below, or for a number without one, its organization's.
   */
  transferMode: TransferMode | null
  transferAlias: string | null
  transferCbu: string | null
  transferHolder: string | null
  transferBank: string | null
  /** Who gets the e-mail of each new claim. Never sent to the bot. */
  claimsEmail: string | null
  /**
   * What the bot adds, as a last line, after every quote it gives ("Un asesor
   * seguro te va a poder mejorar el precio con una bonificación"). Null: the
   * quote ends as the model wrote it.
   */
  quoteClosingNote: string | null
}

/** The only transfer mode stored: no account is given, the office passes the data. */
export const TRANSFER_BY_OFFICE = 'office'
export type TransferMode = typeof TRANSFER_BY_OFFICE

export const BOT_PROFILE_FIELDS = [
  'orgName',
  'orgShortName',
  'orgLegalName',
  'towTruckPhone',
  'claimsPhone',
  'cashPaymentPlaces',
  'transferMode',
  'transferAlias',
  'transferCbu',
  'transferHolder',
  'transferBank',
  'claimsEmail',
  'quoteClosingNote',
] as const satisfies ReadonlyArray<keyof BotProfile>

/** The profile as the bot receives it on GET /bot/context. */
export interface BotContextProfile {
  orgName: string
  orgShortName: string | null
  orgLegalName: string | null
  towTruckPhone: string | null
  claimsPhone: string | null
  cashPaymentPlaces: string | null
  /** Null when there is no account to transfer to, or the office passes the data: the bot gives none. */
  transfer: { alias: string | null; cbu: string | null; holder: string | null; bank: string | null } | null
  /** The last line of every quote the bot gives; null = none. */
  quoteClosingNote: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** A field's stored value: text, and for the transfer mode only a mode that exists. */
function valueOf(field: keyof BotProfile, value: unknown): string | null {
  const t = text(value)
  return field === 'transferMode' && t !== TRANSFER_BY_OFFICE ? null : t
}

/** Reads the stored JSON; anything missing or malformed is null. */
export function parseBotProfile(raw: unknown): BotProfile {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(
    BOT_PROFILE_FIELDS.map(field => [field, valueOf(field, source[field])]),
  ) as unknown as BotProfile
}

/** The bank account customers transfer to: one account, never mixed with another's fields. */
export const TRANSFER_FIELDS: ReadonlyArray<keyof BotProfile> = [
  'transferAlias',
  'transferCbu',
  'transferHolder',
  'transferBank',
]

/** How a number pays by transfer, taken from the number or from its organization as a whole. */
export const TRANSFER_SETTINGS: ReadonlyArray<keyof BotProfile> = ['transferMode', ...TRANSFER_FIELDS]

/** Whether the profile sets its own way to pay by transfer: an account, or the office passing the data. */
export const hasOwnTransfer = (profile: BotProfile): boolean => TRANSFER_SETTINGS.some(field => profile[field] != null)

/**
 * Applies the fields sent (an empty string clears one) over the stored profile.
 * Typing an account goes back to giving it, and the office passing the data
 * leaves no account behind.
 */
export function mergeBotProfile(raw: unknown, changes: Partial<Record<keyof BotProfile, string>>): BotProfile {
  const merged: Record<keyof BotProfile, string | null> = { ...parseBotProfile(raw) }
  for (const field of BOT_PROFILE_FIELDS) {
    if (changes[field] !== undefined) merged[field] = valueOf(field, changes[field])
  }
  if (changes.transferMode === undefined && TRANSFER_FIELDS.some(field => text(changes[field]))) {
    merged.transferMode = null
  }
  if (merged.transferMode === TRANSFER_BY_OFFICE) {
    for (const field of TRANSFER_FIELDS) merged[field] = null
  }
  return merged as BotProfile
}

/**
 * A number's own profile over its organization's: each field the number filled
 * in wins and the rest come from the organization. The transfer goes as a
 * whole: a number with an account of its own, or set to have the office pass
 * the data, uses only its own setting, so an alias never travels with another
 * account's CBU or holder and a branch that gives no alias never shows the
 * organization's. Null when neither has a profile, so the default organization
 * keeps the bot's own values.
 */
export function overlayBotProfile(organization: unknown, number: unknown): BotProfile | null {
  if (organization == null && number == null) return null
  const own = parseBotProfile(number)
  const base = parseBotProfile(organization)
  const ownTransfer = hasOwnTransfer(own)
  return Object.fromEntries(
    BOT_PROFILE_FIELDS.map(field => [
      field,
      ownTransfer && TRANSFER_SETTINGS.includes(field) ? own[field] : (own[field] ?? base[field]),
    ]),
  ) as unknown as BotProfile
}

/**
 * The profile the bot works with. Null for the default organization while it
 * has no saved profile: the bot then keeps the values it always had, so an
 * unmigrated database never changes what JPMG's customers read. Any other
 * organization gets its own name and nothing it did not configure.
 */
export function toBotContextProfile(
  producer: { name: string; botProfile: unknown },
  isDefaultProducer: boolean,
): BotContextProfile | null {
  if (producer.botProfile == null && isDefaultProducer) return null
  const p = parseBotProfile(producer.botProfile)
  return {
    orgName: p.orgName ?? producer.name,
    orgShortName: p.orgShortName,
    orgLegalName: p.orgLegalName,
    towTruckPhone: p.towTruckPhone,
    claimsPhone: p.claimsPhone,
    cashPaymentPlaces: p.cashPaymentPlaces,
    transfer:
      p.transferMode !== TRANSFER_BY_OFFICE && (p.transferAlias || p.transferCbu)
        ? { alias: p.transferAlias, cbu: p.transferCbu, holder: p.transferHolder, bank: p.transferBank }
        : null,
    quoteClosingNote: p.quoteClosingNote,
  }
}
