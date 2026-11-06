import {
  latestVersion,
  NOTICE_TEMPLATES,
  renderTemplate,
  templateParams,
  type NoticeTemplateVersion,
} from '../notices/notice-templates'

/**
 * The Meta template of the expired-policy notice (src/notices/notice-templates.ts).
 * The organization's name is a variable so every organization sends its own.
 */
export const EXPIRY_TEMPLATE = NOTICE_TEMPLATES.policy_expiry

export interface ExpiryNoticeData {
  clientFirstName: string
  organizationName: string
  certificateNumber: string
  /** What the policy covered, as the client knows it: the plate, else the product or risk. */
  item: string
  validTo: Date
}

/** Body variables of the template version, in order. */
export function expiryNoticeParams(
  data: ExpiryNoticeData,
  version: NoticeTemplateVersion = latestVersion(EXPIRY_TEMPLATE),
): string[] {
  return templateParams(version, {
    firstName: titleCase(data.clientFirstName.split(/\s+/)[0] || data.clientFirstName),
    organization: data.organizationName,
    certificate: data.certificateNumber,
    item: data.item,
    validTo: formatDate(data.validTo),
  })
}

/** The notice as the client reads it. */
export function renderExpiryNotice(
  params: string[],
  version: NoticeTemplateVersion = latestVersion(EXPIRY_TEMPLATE),
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
