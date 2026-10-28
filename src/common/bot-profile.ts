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

export const BOT_PROFILE_FIELDS = [
  'orgName',
  'orgShortName',
  'orgLegalName',
  'towTruckPhone',
  'claimsPhone',
  'cashPaymentPlaces',
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
  /** Null when there is no account to transfer to: the office passes the data. */
  transfer: { alias: string | null; cbu: string | null; holder: string | null; bank: string | null } | null
  /** The last line of every quote the bot gives; null = none. */
  quoteClosingNote: string | null
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Reads the stored JSON; anything missing or malformed is null. */
export function parseBotProfile(raw: unknown): BotProfile {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(BOT_PROFILE_FIELDS.map(field => [field, text(source[field])])) as unknown as BotProfile
}

/** Applies the fields sent (an empty string clears one) over the stored profile. */
export function mergeBotProfile(raw: unknown, changes: Partial<Record<keyof BotProfile, string>>): BotProfile {
  const merged = parseBotProfile(raw)
  for (const field of BOT_PROFILE_FIELDS) {
    if (changes[field] !== undefined) merged[field] = text(changes[field])
  }
  return merged
}

/** The bank account customers transfer to: one account, never mixed with another's fields. */
const TRANSFER_FIELDS: ReadonlyArray<keyof BotProfile> = [
  'transferAlias',
  'transferCbu',
  'transferHolder',
  'transferBank',
]

/**
 * A number's own profile over its organization's: each field the number filled
 * in wins and the rest come from the organization. The transfer account goes as
 * a whole: a number with any account field of its own uses only its own, so an
 * alias never travels with another account's CBU or holder. Null when neither
 * has a profile, so the default organization keeps the bot's own values.
 */
export function overlayBotProfile(organization: unknown, number: unknown): BotProfile | null {
  if (organization == null && number == null) return null
  const own = parseBotProfile(number)
  const base = parseBotProfile(organization)
  const ownAccount = TRANSFER_FIELDS.some(field => own[field] != null)
  return Object.fromEntries(
    BOT_PROFILE_FIELDS.map(field => [
      field,
      ownAccount && TRANSFER_FIELDS.includes(field) ? own[field] : (own[field] ?? base[field]),
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
      p.transferAlias || p.transferCbu
        ? { alias: p.transferAlias, cbu: p.transferCbu, holder: p.transferHolder, bank: p.transferBank }
        : null,
    quoteClosingNote: p.quoteClosingNote,
  }
}
