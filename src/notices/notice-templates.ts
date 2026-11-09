import { parseBotProfile } from '../common/bot-profile'

/**
 * The notices the platform sends with a Meta template: one text per notice for
 * every organization and every number, kept here word for word (the panel
 * shows each notice as the client got it, and the bot reads it back as the
 * office's last message when they answer).
 *
 * Meta keeps a template inside one WhatsApp account and reviews it there, so
 * TemplateSyncService creates the newest version in every account by itself.
 * Changing a text means adding a version with a new name at the end: Meta
 * reviews it in every account while each number keeps sending the newest
 * version its account has approved, so the notices never stop.
 */
export type NoticeTemplateKind = 'policy_expiry' | 'payment_rejection'

export interface NoticeTemplateVersion {
  /** The template's name in Meta. */
  name: string
  /** As Meta takes it: {{1}}, {{2}}… in the order of `variables`. */
  body: string
  variables: readonly string[]
}

export interface NoticeTemplate {
  kind: NoticeTemplateKind
  /** What the platform uses it for, as the owner's Plantillas page says it. */
  use: string
  /** The server setting that turns these notices on (any value). */
  env: string
  category: 'UTILITY'
  lang: string
  /** Oldest first: the last one is the one created in every account. */
  versions: readonly NoticeTemplateVersion[]
  /** A sample of every variable, for Meta's review. */
  examples: Readonly<Record<string, string>>
}

export const NOTICE_TEMPLATES: Readonly<Record<NoticeTemplateKind, NoticeTemplate>> = {
  policy_expiry: {
    kind: 'policy_expiry',
    use: 'Avisos de pólizas vencidas',
    env: 'POLICY_EXPIRY_TEMPLATE',
    category: 'UTILITY',
    lang: 'es_AR',
    versions: [
      {
        name: 'aviso_poliza_vencida',
        body:
          'Hola {{1}}, te escribimos de {{2}}, tu productor de seguros. ' +
          'Tu póliza {{3}} ({{4}}) venció el {{5}}. ' +
          'Si querés renovarla o cotizar otra opción, respondé este mensaje y te ayudamos.',
        variables: ['firstName', 'organization', 'certificate', 'item', 'validTo'],
      },
    ],
    examples: {
      firstName: 'Juan',
      organization: 'Seguros del Litoral',
      certificate: '1234567',
      item: 'AB123CD',
      validTo: '15/10/2026',
    },
  },
  payment_rejection: {
    kind: 'payment_rejection',
    use: 'Avisos de rechazos de pago',
    env: 'PAYMENT_REJECTION_TEMPLATE',
    category: 'UTILITY',
    lang: 'es_AR',
    versions: [
      // The first text named the first organization; only its accounts have it.
      {
        name: 'aviso_rechazo_pago',
        body:
          'Hola {{1}}, te escribimos de JP Management Group, tu productor de seguros. ' +
          'Triunfo Seguros nos informó que no se pudo cobrar la cuota {{2}} de tu póliza {{3}} ' +
          '(vencimiento {{4}}, importe ${{5}}) por {{6}}. Para que tu cobertura no quede suspendida, ' +
          'respondé este mensaje y te ayudamos a regularizar el pago.',
        variables: ['firstName', 'installment', 'certificate', 'dueDate', 'amount', 'reason'],
      },
      {
        name: 'aviso_rechazo_pago_v2',
        body:
          'Hola {{1}}, te escribimos de {{2}}, tu productor de seguros. ' +
          'Triunfo Seguros nos informó que no se pudo cobrar la cuota {{3}} de tu póliza {{4}} ' +
          '(vencimiento {{5}}, importe ${{6}}) por {{7}}. Para que tu cobertura no quede suspendida, ' +
          'respondé este mensaje y te ayudamos a regularizar el pago.',
        variables: ['firstName', 'organization', 'installment', 'certificate', 'dueDate', 'amount', 'reason'],
      },
    ],
    examples: {
      firstName: 'Juan',
      organization: 'Seguros del Litoral',
      installment: '3',
      certificate: '1234567',
      dueDate: '10/10/2026',
      amount: '45.300',
      reason: 'falta de fondos en la cuenta',
    },
  },
}

/** The version every account should have. */
export function latestVersion(template: NoticeTemplate): NoticeTemplateVersion {
  return template.versions[template.versions.length - 1]
}

/** Meta rejects template variables with new lines, tabs or runs of spaces. */
function metaSafe(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** The body variables of a version, in order, from the notice's values. */
export function templateParams(version: NoticeTemplateVersion, values: Readonly<Record<string, string>>): string[] {
  return version.variables.map(key => metaSafe(values[key] ?? ''))
}

/** The notice as the client reads it. */
export function renderTemplate(version: NoticeTemplateVersion, params: string[]): string {
  return version.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '')
}

/**
 * The newest version among `approved` (template names Meta approved in an
 * account), or null when the account has none of them approved.
 */
export function newestApproved(template: NoticeTemplate, approved: ReadonlySet<string>): NoticeTemplateVersion | null {
  for (let i = template.versions.length - 1; i >= 0; i--) {
    if (approved.has(template.versions[i].name)) return template.versions[i]
  }
  return null
}

/** How a notice names the organization: as its bot does, else its name. */
export function noticeOrganizationName(producer: { name: string; botProfile: unknown }): string {
  return parseBotProfile(producer.botProfile).orgName || producer.name
}
