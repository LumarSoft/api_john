import { BUSINESS_TZ } from '../business-hours/schedule'
import { formatDuration } from '../users/bot-status-alert.service'

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

/** "el 30/10 a las 20:19" */
function when(at: Date): string {
  return `el ${dateFmt.format(at)} a las ${timeFmt.format(at)}`
}

// What stops working while Triunfo refuses the credentials, in the office's words.
const IMPACT =
  'Mientras tanto el bot y el panel no pueden traer pólizas ni documentos, no se puede cotizar y la cartera no se actualiza.'
const FIX =
  'Si cambiaron la contraseña de TriunfoNet, hay que cargar la nueva en Organizaciones → Triunfo (Lumarsoft) para que todo vuelva a andar.'

/** The outage announcement (and its daily reminder) for the office and Lumarsoft. */
export function credentialsRejectedCopy(input: {
  producerName: string
  since: Date
  message: string
  reminder: boolean
  now?: Date
}): AlertCopy {
  const now = input.now ?? new Date()
  const subject = input.reminder
    ? `⚠️ Triunfo sigue rechazando las credenciales — ${input.producerName}`
    : `⚠️ Triunfo rechaza las credenciales — ${input.producerName}`
  const lasting = input.reminder ? ` Ya lleva ${formatDuration(input.since, now)}.` : ''
  const text =
    `Desde ${when(input.since)} Triunfo rechaza las credenciales de ${input.producerName}: «${input.message}».${lasting} ` +
    `${IMPACT} ${FIX}`
  return { subject, text }
}

/** The outage is over. */
export function credentialsRecoveredCopy(input: { producerName: string; since: Date; at: Date }): AlertCopy {
  return {
    subject: `✅ Triunfo volvió a aceptar las credenciales — ${input.producerName}`,
    text:
      `Triunfo vuelve a aceptar las credenciales de ${input.producerName} desde ${when(input.at)}, ` +
      `después de ${formatDuration(input.since, input.at)} rechazándolas. Pólizas, documentos, cotizaciones y cartera vuelven a andar.`,
  }
}

/** A failure we had not seen (or not for a week): often a change on Triunfo's side. For Lumarsoft only. */
export function newErrorCopy(input: {
  producerName: string
  operation: string
  kind: string
  httpStatus: number | null
  message: string
  reappeared: boolean
}): AlertCopy {
  const status = input.httpStatus != null ? ` HTTP ${input.httpStatus}` : ''
  return {
    subject: `${input.reappeared ? '🔁 Volvió un error' : '🆕 Error nuevo'} de Triunfo en ${input.operation} — ${input.producerName}`,
    text:
      `${input.operation} falló para ${input.producerName} (${input.kind}${status}): «${input.message}». ` +
      (input.reappeared
        ? 'Hacía más de una semana que no aparecía. '
        : 'No lo habíamos visto antes: puede ser un cambio de Triunfo (un header, un campo, una URL). ') +
      'El detalle y las veces que se repite están en Organizaciones → Triunfo.',
  }
}
