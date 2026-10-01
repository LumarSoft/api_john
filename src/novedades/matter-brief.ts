import { MatterCategory, MatterStatus, NovedadType } from './dto/list-novedades.dto'

type Matter = { category: string; status: string; type: string; body: string | null; refId: number }

const ACTIONS: Record<MatterCategory, string> = {
  baja: 'Revisar la póliza y confirmar con el cliente el trámite de baja.',
  pagos: 'Verificar cuotas, vencimientos y comprobantes antes de responder.',
  cotizacion: 'Revisar los datos del riesgo y preparar o confirmar la propuesta.',
  siniestro: 'Revisar la denuncia y la documentación para darle seguimiento.',
  documentos: 'Revisar qué documento o cambio necesita y gestionar el pedido.',
  other: 'Leer la conversación, precisar el motivo y clasificar el asunto.',
}

/** Uses only the recorded request. Suggestions never assert that work was done. */
export function matterBrief(matter: Matter) {
  const original = matter.body?.replace(/\s+/g, ' ').trim()
  const summary = original
    ? original.length > 280
      ? `${original.slice(0, 280)}…`
      : original
    : 'No se registró el motivo. Revisar la conversación o el detalle del pedido.'
  const resolved = matter.status === MatterStatus.RESOLVED
  const outcome = resolved
    ? 'Marcado como resuelto por el equipo'
    : matter.refId <= 0
      ? 'Referencia del pedido pendiente de revisión'
      : matter.status === MatterStatus.IN_PROGRESS
        ? 'En atención por el equipo'
        : matter.type === NovedadType.SINIESTRO
          ? 'Denuncia registrada; pendiente de revisión'
          : matter.type === NovedadType.BAJA_POLIZA
            ? 'Solicitud recibida; la baja requiere gestión'
            : matter.type === NovedadType.LEAD || matter.type === NovedadType.SOLICITUD
              ? 'Solicitud de cotización o contratación recibida'
              : 'Pedido recibido; pendiente de atención'
  return {
    summary,
    outcome,
    nextAction: resolved
      ? null
      : matter.refId <= 0
        ? 'Revisar la referencia del pedido antes de gestionar el asunto.'
        : (ACTIONS[matter.category as MatterCategory] ?? ACTIONS.other),
  }
}
