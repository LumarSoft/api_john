import type { IntegrationFailureKind } from 'generated/prisma/client'
import { BUSINESS_TZ } from '../business-hours/schedule'
import { formatDuration } from '../users/bot-status-alert.service'
import type { IncidentExplanation } from './incident-explainer.service'

export interface AlertCopy {
  subject: string
  text: string
}

const dateFmt = new Intl.DateTimeFormat('es-AR', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "el 03/11 a las 11:21" */
function when(at: Date): string {
  return `el ${dateFmt.format(at)} a las ${timeFmt.format(at)}`
}

/** "Triunfo Seguros", "la plataforma" */
function responsible(blame: IncidentExplanation['blame'], provider: string): string {
  if (blame === 'PROVIDER') return provider
  if (blame === 'PLATFORM') return 'la plataforma'
  return 'sin determinar'
}

/**
 * A service that started failing, as the AI model explained it, for whoever
 * answers the office's clients when they complain (INTEGRATION_ALERT_EMAIL).
 */
export function incidentExplainedCopy(input: {
  provider: string
  service: string
  explanation: IncidentExplanation
  kind: IntegrationFailureKind
  httpStatus: number | null
  message: string
  /** What the provider answered, in its own words. */
  answer: string | null
  startedAt: Date
  failures: number
  now?: Date
}): AlertCopy {
  const now = input.now ?? new Date()
  const who = responsible(input.explanation.blame, input.provider)
  const attempts = `${input.failures} ${input.failures === 1 ? 'intento fallido' : 'intentos fallidos'}`
  const lines = [
    input.explanation.explanation,
    '',
    `Responsable: ${input.explanation.blameReason || who}`,
    `Desde ${when(input.startedAt)} (${formatDuration(input.startedAt, now)}) · ${attempts}.`,
    ...(input.answer ? [`Qué respondió ${input.provider}: «${input.answer}»`] : []),
    `Detalle técnico: ${input.kind}${input.httpStatus != null ? ` ${input.httpStatus}` : ''} — ${input.message}`,
    '',
    'La explicación la escribió la IA a partir del error. El estado al momento está en el panel, sección Status.',
  ]
  return {
    subject: `⚠️ Falla en ${input.provider}: ${input.service} — responsable: ${who}`,
    text: lines.join('\n'),
  }
}
