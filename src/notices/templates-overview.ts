import { CAMPAIGNS } from '../sales-campaigns/campaign-catalog'
import type { MetaTemplate } from './waba-templates.service'

/** A template the platform needs in every account of an organization, and what it is for. */
export interface ExpectedTemplate {
  name: string
  lang: string
  use: string
  /** The platform creates it in every account by itself (TemplateSyncService). */
  managed: boolean
  /** Earlier texts of the same notice, oldest first: a number sends the newest one approved while this one is reviewed. */
  previous?: string[]
}

/** One template of an account, as the owner's Plantillas page lists it. */
export interface TemplateRowView {
  name: string
  language: string
  category: string | null
  /** Meta's status (APPROVED, PENDING, REJECTED, PAUSED, DISABLED…), or MISSING when the platform needs it and Meta does not have it. */
  status: string
  /** Why Meta rejected it, said for the owner. */
  reason: string | null
  /** GREEN, YELLOW, RED or UNKNOWN. */
  quality: string | null
  /** What the platform uses it for; null when it does not use it. */
  use: string | null
  /** The platform sends it now (a configured notice, a campaign's current text). */
  inUse: boolean
  /** The platform creates it by itself in every account: missing, it shows up within the hour. */
  managed: boolean
}

/** Why Meta rejected a template, for the owner. */
const REJECTION_REASONS: Record<string, string> = {
  INVALID_FORMAT: 'Formato inválido (datos variables o signos).',
  ABUSIVE_CONTENT: 'Contenido abusivo según Meta.',
  INCORRECT_CATEGORY: 'Categoría incorrecta.',
  TAG_CONTENT_MISMATCH: 'El texto no corresponde a la categoría.',
  SCAM: 'Posible estafa según Meta.',
  PROMOTIONAL: 'Promocional de una forma que Meta no acepta.',
}

export function rejectionText(code: string | null): string | null {
  if (!code) return null
  return REJECTION_REASONS[code] ?? code
}

const CAMPAIGN_NAME = /^(.+)_v(\d+)$/

/** What an old version of a campaign's text is, or null for a template the platform does not know. */
function campaignOfTemplate(name: string): string | null {
  const match = CAMPAIGN_NAME.exec(name)
  if (!match) return null
  const campaign = Object.values(CAMPAIGNS).find(c => c.templateSlug === match[1])
  return campaign ? `Campaña: ${campaign.label} (texto anterior)` : null
}

/**
 * The templates of one account: first the ones the platform needs, in order
 * (MISSING when Meta does not have them in that language), then every other
 * template Meta has there, an old campaign text named as such.
 */
export function accountRows(meta: MetaTemplate[], expected: ExpectedTemplate[]): TemplateRowView[] {
  const used = new Set<MetaTemplate>()
  const rows: TemplateRowView[] = expected.map(want => {
    const found = meta.find(t => t.name === want.name && t.language === want.lang)
    if (!found) {
      return {
        name: want.name,
        language: want.lang,
        category: null,
        status: 'MISSING',
        reason: null,
        quality: null,
        use: want.use,
        inUse: true,
        managed: want.managed,
      }
    }
    used.add(found)
    return { ...view(found), use: want.use, inUse: true, managed: want.managed }
  })
  const others = meta
    .filter(t => !used.has(t))
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
    .map(t => {
      const notice = expected.find(want => want.lang === t.language && want.previous?.includes(t.name))
      if (notice) {
        return {
          ...view(t),
          use: `${notice.use} (texto anterior)`,
          inUse: sendsEarlierText(meta, notice, t),
          managed: false,
        }
      }
      return { ...view(t), use: campaignOfTemplate(t.name), inUse: false, managed: false }
    })
  return [...rows, ...others]
}

/** While Meta reviews a notice's new text, the account sends the newest earlier one it has approved. */
function sendsEarlierText(meta: MetaTemplate[], notice: ExpectedTemplate, template: MetaTemplate): boolean {
  const approved = (name: string) =>
    meta.some(m => m.name === name && m.language === notice.lang && m.status === 'APPROVED')
  if (approved(notice.name) || template.status !== 'APPROVED') return false
  const earlier = (notice.previous ?? []).filter(approved)
  return earlier[earlier.length - 1] === template.name
}

function view(t: MetaTemplate): Omit<TemplateRowView, 'use' | 'inUse' | 'managed'> {
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    reason: rejectionText(t.rejectedReason),
    quality: t.quality,
  }
}
